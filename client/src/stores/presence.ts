import { create as createProto } from "@bufbuild/protobuf";
import { create } from "zustand";

import type { WsClient } from "../api/ws";
import {
  GetPresenceSchema,
  PresenceStatus,
  type PresenceUpdated,
  SetIdleSchema,
} from "../gen/v1/presence_pb";

export { PresenceStatus };

const IDLE_AFTER_MS = 5 * 60_000;
const MAX_IDS = 200;

interface PresenceState {
  statuses: Record<string, PresenceStatus>;
  revisions: Record<string, bigint>;
  attach: (ws: WsClient) => void;
  load: (ws: WsClient, userIds: string[]) => Promise<void>;
}

let stopListening: (() => void) | undefined;
let stopIdle: (() => void) | undefined;

export const usePresence = create<PresenceState>()((set) => ({
  statuses: {},
  revisions: {},

  attach: (ws) => {
    stopListening?.();
    stopListening = ws.addPushListener((payload) => {
      if (payload.case !== "presenceUpdated") return;
      set((s) => mergePresenceUpdates(s, [payload.value]));
    });
    stopIdle?.();
    stopIdle = watchIdle((idle) => {
      ws.request({ case: "setIdle", value: createProto(SetIdleSchema, { idle }) }).catch(() => {});
    });
  },

  load: async (ws, userIds) => {
    const ids = [...new Set(userIds)];
    const pages: string[][] = [];
    for (let i = 0; i < ids.length; i += MAX_IDS) pages.push(ids.slice(i, i + MAX_IDS));
    await Promise.all(
      pages.map(async (page) => {
        try {
          const reply = await ws.request({
            case: "getPresence",
            value: createProto(GetPresenceSchema, { userIds: page.map(BigInt) }),
          });
          if (reply.case !== "presences") return;
          set((s) => {
            const next = mergePresenceUpdates(s, reply.value.presences);
            const returned = new Set(reply.value.presences.map((p) => p.userId.toString()));
            for (const id of page) {
              if (!returned.has(id)) {
                next.statuses[id] = PresenceStatus.OFFLINE;
                next.revisions[id] ??= 0n;
              }
            }
            return next;
          });
        } catch {
          return;
        }
      }),
    );
  },
}));

export function mergePresenceUpdates(
  state: Pick<PresenceState, "statuses" | "revisions">,
  updates: PresenceUpdated[],
): Pick<PresenceState, "statuses" | "revisions"> {
  const statuses = { ...state.statuses };
  const revisions = { ...state.revisions };
  for (const update of updates) {
    const id = update.userId.toString();
    if (update.revision < (revisions[id] ?? 0n)) continue;
    statuses[id] = update.status;
    revisions[id] = update.revision;
  }
  return { statuses, revisions };
}

function watchIdle(report: (idle: boolean) => void): () => void {
  let idle = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const setIdle = (next: boolean) => {
    if (next === idle) return;
    idle = next;
    report(idle);
  };
  const onActivity = () => {
    if (document.hidden) return;
    setIdle(false);
    clearTimeout(timer);
    timer = setTimeout(() => setIdle(true), IDLE_AFTER_MS);
  };
  const onVisibility = () => (document.hidden ? setIdle(true) : onActivity());

  const events = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
  for (const e of events) window.addEventListener(e, onActivity, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  onVisibility();

  return () => {
    clearTimeout(timer);
    for (const e of events) window.removeEventListener(e, onActivity);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
