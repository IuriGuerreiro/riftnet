import { create } from "zustand";

import { freshAccessToken } from "../api/http";
import { WsClient } from "../api/ws";
import type { User } from "../gen/v1/users_pb";

// The app's single WebSocket and its status.
// Reconnects automatically (1s, 2s, 4s… max 30s) unless the server said
// "unauthorized" (close code 4001) or we disconnected on purpose.
type Status = "offline" | "connecting" | "online";

interface ConnectionState {
  status: Status;
  error: string | null;
  ws: WsClient | null;
  user: User | null; // me, as the socket's auth_ok reported
  connect: () => Promise<void>;
  disconnect: () => void;
}

let retryTimer: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let wanted = false; // false after disconnect(): don't reconnect

export const useConnection = create<ConnectionState>()((set, get) => ({
  status: "offline",
  error: null,
  ws: null,
  user: null,

  connect: async () => {
    wanted = true;
    if (get().status !== "offline") return;
    clearTimeout(retryTimer);
    set({ status: "connecting", error: null });

    try {
      const token = await freshAccessToken();
      if (!token) throw new Error("not logged in");
      const { ws, user } = await WsClient.connect(token);
      attempt = 0;
      ws.onClose = (code) => {
        set({ status: "offline", ws: null });
        if (code === 4001) set({ error: "unauthorized" });
        else scheduleRetry();
      };
      set({ status: "online", ws, user: user ?? null });
    } catch (e) {
      set({ status: "offline", ws: null, error: (e as Error).message });
      scheduleRetry();
    }

    function scheduleRetry() {
      if (!wanted) return;
      const delay = Math.min(30_000, 1000 * 2 ** attempt++);
      retryTimer = setTimeout(() => void get().connect(), delay);
    }
  },

  disconnect: () => {
    wanted = false;
    clearTimeout(retryTimer);
    get().ws?.close();
    set({ status: "offline", ws: null });
  },
}));
