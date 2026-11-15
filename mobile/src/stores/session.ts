import { create } from 'zustand';

// Placeholder auth state so navigation can switch stacks.
// Next PR: reuse the real auth flow from client/ (tokens in the OS keychain).
interface SessionState {
  loggedIn: boolean;
  setLoggedIn: (v: boolean) => void;
}

export const useSession = create<SessionState>(set => ({
  loggedIn: false,
  setLoggedIn: loggedIn => set({ loggedIn }),
}));
