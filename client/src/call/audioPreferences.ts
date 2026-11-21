import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const percent = z.number().min(0).max(100);
export const audioDefaults = {
  inputId: "",
  outputId: "",
  inputVolume: 100,
  voiceVolume: 100,
  suppression: "standard" as const,
};
const schema = z.object({
  inputId: z.string().catch(""),
  outputId: z.string().catch(""),
  inputVolume: z.number().min(0).max(200).catch(100),
  voiceVolume: percent.catch(100),
  suppression: z.enum(["off", "standard", "enhanced"]).catch("standard"),
  people: z.record(z.string(), z.number().min(0).max(200)).catch({}),
});

export type AudioPreferences = z.infer<typeof schema>;
type AudioSettings = AudioPreferences & {
  update: (prefs: Partial<AudioPreferences>) => void;
  setPersonVolume: (id: bigint, volume: number) => void;
  reset: () => void;
};

export const useAudioSettings = create<AudioSettings>()(
  persist(
    (set) => ({
      ...audioDefaults,
      people: {},
      update: (prefs) => set(prefs),
      setPersonVolume: (id, volume) =>
        set(({ people }) => ({ people: { ...people, [id.toString()]: volume } })),
      reset: () => set({ ...audioDefaults, people: {} }),
    }),
    {
      name: "voice-audio",
      merge: (saved, current) => ({ ...current, ...schema.parse(saved ?? {}) }),
    },
  ),
);

export function participantVolume(prefs: AudioPreferences, userId?: bigint) {
  return userId === undefined ? 100 : (prefs.people[userId.toString()] ?? 100);
}
