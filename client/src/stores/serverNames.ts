import { create } from "zustand";

import type { ChannelMessage } from "../gen/v1/messages_pb";
import { snowflakeTime } from "../lib/time";

interface ServerName {
  name: string;
  at: number;
}

interface ServerNamesStore {
  byServer: Record<string, Record<string, ServerName>>;
  set: (serverId: string, userId: string, name: string) => void;
  forget: (serverId: string) => void;
  reset: () => void;
}

export const useServerNames = create<ServerNamesStore>()((set, get) => ({
  byServer: {},
  set: (serverId, userId, name) => {
    const byServer = get().byServer;
    set({
      byServer: {
        ...byServer,
        [serverId]: { ...byServer[serverId], [userId]: { name, at: Date.now() } },
      },
    });
  },
  forget: (serverId) => {
    set({
      byServer: Object.fromEntries(
        Object.entries(get().byServer).filter(([id]) => id !== serverId),
      ),
    });
  },
  reset: () => set({ byServer: {} }),
}));

export function pickAuthorName(message: ChannelMessage, live: ServerName | undefined): string {
  if (live && snowflakeTime(message.id).getTime() < live.at) return live.name;
  return message.authorName;
}

export function useAuthorName(serverId: string, message: ChannelMessage): string {
  const live = useServerNames((s) => s.byServer[serverId]?.[message.authorId.toString()]);
  return pickAuthorName(message, live);
}
