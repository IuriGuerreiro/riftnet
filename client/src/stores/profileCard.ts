import { create } from "zustand";

export interface CardAnchor {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

interface ProfileCardStore {
  shown: { userId: string; anchor: CardAnchor } | null;
  toggle: (userId: string, anchor: CardAnchor) => void;
  close: () => void;
}

export const useProfileCard = create<ProfileCardStore>()((set, get) => ({
  shown: null,
  toggle: (userId, anchor) =>
    set({ shown: get().shown?.userId === userId ? null : { userId, anchor } }),
  close: () => set({ shown: null }),
}));
