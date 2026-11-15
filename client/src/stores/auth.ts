import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { platform } from "../platform/current";
import type { Session, User } from "../api/types";

// Auth state for the whole app.
// Tokens live in `platform.storage`: localStorage on web, the OS keychain on mobile.
// TODO(desktop): OS keychain via client-core instead of localStorage.
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
    {
      name: "auth",
      // Lazy, so the platform's storage is read when used (it may be async).
      storage: createJSONStorage(() => ({
        getItem: (k) => platform.storage.getItem(k),
        setItem: (k, v) => platform.storage.setItem(k, v),
        removeItem: (k) => platform.storage.removeItem(k),
      })),
      // Only the tokens + user; actions aren't data.
      partialize: (s) => ({
        accessToken: s.accessToken,
        accessExpiresAt: s.accessExpiresAt,
        refreshToken: s.refreshToken,
        user: s.user,
      }),
    },
  ),
);
