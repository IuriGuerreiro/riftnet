import { create as createProto } from "@bufbuild/protobuf";
import { create } from "zustand";

import type { WsClient } from "../api/ws";
import { type FriendActivity, GetActivitiesSchema, SetActivitySchema } from "../gen/v1/presence_pb";

interface ActivityState {
  byId: Record<string, FriendActivity>;
  published: { ws: Pick<WsClient, "request">; label: string } | null;
  publish: (ws: Pick<WsClient, "request">, label: string) => Promise<void>;
  clear: () => void;
  watch: (ws: Pick<WsClient, "request">, ids: string[]) => () => void;
}

let publication = 0;

export const useActivity = create<ActivityState>((set) => ({
  byId: {},
  published: null,
  publish: async (ws, label) => {
    const version = ++publication;
    const reply = await ws.request({
      case: "setActivity",
      value: createProto(SetActivitySchema, { label }),
    });
    if (reply.case !== "pong") throw new Error("Could not update activity");
    if (version === publication) set({ published: { ws, label } });
  },
  clear: () => set({ byId: {} }),
  watch: (ws, ids) => {
    let stopped = false;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    set({ byId: {} });
    const load = async () => {
      const byId: Record<string, FriendActivity> = {};
      try {
        for (let i = 0; i < ids.length; i += 200) {
          const reply = await ws.request({
            case: "getActivities",
            value: createProto(GetActivitiesSchema, { userIds: ids.slice(i, i + 200).map(BigInt) }),
          });
          if (reply.case !== "activities") throw new Error("Could not load activity");
          for (const activity of reply.value.activities)
            byId[activity.userId.toString()] = activity;
        }
        if (!stopped) {
          set({ byId });
          clearTimeout(staleTimer);
          staleTimer = setTimeout(() => set({ byId: {} }), 20_000);
        }
      } catch {
        if (!stopped) set({ byId: {} });
      }
      if (!stopped) timer = setTimeout(() => void load(), 10_000);
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(staleTimer);
      set({ byId: {} });
    };
  },
}));
