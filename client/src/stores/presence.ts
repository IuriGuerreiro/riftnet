import { create as createProto } from "@bufbuild/protobuf";
import { create } from "zustand";
import type { WsClient } from "../api/ws";
import { GetPresenceSchema, PresenceStatus, SetIdleSchema } from "../gen/v1/presence_pb";

// Who's online, for friends and DM members (see docs/architecture/presence.md).
//   - get_presence: current status, after (re)connect and when the lists change
//   - push:         presenceUpdated, live
// Also reports this window as idle after 5 min without input, or while hidden.

const IDLE_AFTER_MS = 5 * 60_000;
const MAX_IDS = 200;

interface PresenceState {
  /** user id (string) → status. Unknown = offline. */
  statuses: Record<string, PresenceStatus>;
  /** Socket (re)connected: follow pushes and report idle. */
  attach: (ws: WsClient) => void;
  /** Load the status of these users (friends + DM members). */
  load: (ws: WsClient, userIds: string[]) => Promise<void>;
}

let stopListening: (() => void) | undefined;
let stopIdle: (() => void) | undefined;

export const usePresence = create<PresenceState>()((set) => ({
  statuses: {},

  attach: (ws) => {
    stopListening?.();
    stopListening = ws.addPushListener((payload) => {
      if (payload.case !== "presenceUpdated") return;
      const { userId, status } = payload.value;
      set((s) => ({ statuses: { ...s.statuses, [userId.toString()]: status } }));
    });
    stopIdle?.();
    stopIdle = watchIdle((idle) => {
      ws.request({ case: "setIdle", value: createProto(SetIdleSchema, { idle }) }).catch(() => {});
    });
  },

  load: async (ws, userIds) => {
    const ids = [...new Set(userIds)].slice(0, MAX_IDS);
    if (ids.length === 0) return;
    try {
      const reply = await ws.request({
        case: "getPresence",
        value: createProto(GetPresenceSchema, { userIds: ids.map(BigInt) }),
      });
      if (reply.case !== "presences") return;
      const next: Record<string, PresenceStatus> = {};
      for (const id of ids) next[id] = PresenceStatus.OFFLINE; // not returned = can't see = offline
      for (const p of reply.value.presences) next[p.userId.toString()] = p.status;
      set((s) => ({ statuses: { ...s.statuses, ...next } }));
    } catch {
      // socket closed: reloads on reconnect
    }
  },
}));

/** Calls `report` when this window becomes idle or active (only on changes). */
function watchIdle(report: (idle: boolean) => void): () => void {
  let idle = false; // a new socket starts active
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
