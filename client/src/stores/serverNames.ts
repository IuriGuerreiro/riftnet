import { create } from "zustand";

interface ServerNamesStore {
  byServer: Record<string, Record<string, string>>;
  set: (serverId: string, userId: string, name: string) => void;
  forget: (serverId: string) => void;
}

export const useServerNames = create<ServerNamesStore>()((set, get) => ({
  byServer: {},
  set: (serverId, userId, name) => {
    const byServer = get().byServer;
    set({ byServer: { ...byServer, [serverId]: { ...byServer[serverId], [userId]: name } } });
  },
  forget: (serverId) => {
    set({
      byServer: Object.fromEntries(
        Object.entries(get().byServer).filter(([id]) => id !== serverId),
      ),
    });
  },
}));

export function useServerName(serverId: string, userId: string | bigint): string | undefined {
  return useServerNames((s) => s.byServer[serverId]?.[userId.toString()]);
}
