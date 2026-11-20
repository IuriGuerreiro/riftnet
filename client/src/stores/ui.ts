import { create } from "zustand";

export type MainView = "friends" | "chat";

interface UiState {
  view: MainView;
  membersOpen: boolean;
  showFriends: () => void;
  showChat: () => void;
  toggleMembers: () => void;
}

export const useUi = create<UiState>()((set) => ({
  view: "friends",
  membersOpen: true,
  showFriends: () => set({ view: "friends" }),
  showChat: () => set({ view: "chat" }),
  toggleMembers: () => set((s) => ({ membersOpen: !s.membersOpen })),
}));
