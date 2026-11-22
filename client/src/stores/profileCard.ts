import { create } from "zustand";

export interface CardAnchor {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

interface ProfileCardStore {
  shown: { userId: string; anchor: CardAnchor; nickname?: string } | null;
  toggle: (userId: string, anchor: CardAnchor, nickname?: string) => void;
  close: () => void;
}

export const useProfileCard = create<ProfileCardStore>()((set, get) => ({
  shown: null,
  toggle: (userId, anchor, nickname) =>
    set({ shown: get().shown?.userId === userId ? null : { userId, anchor, nickname } }),
  close: () => set({ shown: null }),
}));
