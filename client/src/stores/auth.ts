import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Session, User } from "../api/types";

// Auth state for the whole app.
// TODO(desktop): move tokens to the OS keychain via client-core instead of localStorage.
interface AuthState {
  accessToken: string | null;
  accessExpiresAt: number | null; // unix seconds
  refreshToken: string | null;
  user: User | null;
  setSession: (s: Session) => void;
  setUser: (u: User) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      accessExpiresAt: null,
      refreshToken: null,
      user: null,
      setSession: (s) =>
        set({
          accessToken: s.access_token,
          accessExpiresAt: s.access_expires_at,
          refreshToken: s.refresh_token,
          user: s.user,
        }),
      setUser: (user) => set({ user }),
      clear: () => set({ accessToken: null, accessExpiresAt: null, refreshToken: null, user: null }),
    }),
    { name: "auth" },
  ),
);
