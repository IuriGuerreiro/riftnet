import { create } from "zustand";

import { freshAccessToken } from "../api/http";
import { WsClient } from "../api/ws";
import type { User } from "../gen/v1/users_pb";
import { useAuth } from "./auth";

export const CLOSE_UNAUTHORIZED = 4001;
export const CLOSE_TOKEN_EXPIRED = 4002;
export const CLOSE_SESSION_REVOKED = 4003;
const REAUTH_BEFORE_SECS = 25;

type Status = "offline" | "connecting" | "online";

interface ConnectionState {
  status: Status;
  error: string | null;
  ws: WsClient | null;
  user: User | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

let retryTimer: ReturnType<typeof setTimeout> | undefined;
let reauthTimer: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let wanted = false;

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
        clearTimeout(reauthTimer);
        set({ status: "offline", ws: null });
        if (code === CLOSE_UNAUTHORIZED) set({ error: "unauthorized" });
        else if (code === CLOSE_SESSION_REVOKED) {
          wanted = false;
          set({ error: "session_revoked" });
          useAuth.getState().clear();
        } else if (code === CLOSE_TOKEN_EXPIRED) {
          attempt = 0;
          retryTimer = setTimeout(() => void get().connect(), 0);
        } else scheduleRetry();
      };
      set({ status: "online", ws, user: user ?? null });
      scheduleReauth(ws);
    } catch (e) {
      set({ status: "offline", ws: null, error: (e as Error).message });
      scheduleRetry();
    }

    function scheduleReauth(ws: WsClient) {
      clearTimeout(reauthTimer);
      const exp = useAuth.getState().accessExpiresAt;
      if (!exp) return;
      const ms = Math.max(5_000, (exp - REAUTH_BEFORE_SECS) * 1000 - Date.now());
      reauthTimer = setTimeout(() => {
        void (async () => {
          const fresh = await freshAccessToken();
          if (!fresh || get().ws !== ws) return;
          await ws.reauthenticate(fresh).catch(() => {});
          if (get().ws === ws) scheduleReauth(ws);
        })();
      }, ms);
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
    clearTimeout(reauthTimer);
    get().ws?.close();
    set({ status: "offline", ws: null });
  },
}));
