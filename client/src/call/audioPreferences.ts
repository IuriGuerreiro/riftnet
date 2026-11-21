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
  echoCancellation: true,
  autoGainControl: true,
  inputMode: "open" as const,
  automaticSensitivity: true,
  sensitivity: 45,
  pushKey: "F8" as const,
  releaseDelay: 150,
  shareAudio: false,
  streamVolume: 100,
  normalizeVoices: false,
  duckStreams: false,
};
export const pushKeys = ["F6", "F7", "F8", "F9", "F10"] as const;

const schema = z.object({
  inputId: z.string().catch(""),
  outputId: z.string().catch(""),
  inputVolume: z.number().min(0).max(200).catch(100),
  voiceVolume: percent.catch(100),
  suppression: z.enum(["off", "standard", "enhanced"]).catch("standard"),
  echoCancellation: z.boolean().catch(true),
  autoGainControl: z.boolean().catch(true),
  inputMode: z.enum(["open", "voice", "push"]).catch("open"),
  automaticSensitivity: z.boolean().catch(true),
  sensitivity: percent.catch(45),
  pushKey: z.enum(pushKeys).catch("F8"),
  releaseDelay: z.number().min(0).max(1000).catch(150),
  shareAudio: z.boolean().catch(false),
  streamVolume: percent.catch(100),
  normalizeVoices: z.boolean().catch(false),
  duckStreams: z.boolean().catch(false),
  mutedPeople: z.record(z.string(), z.boolean()).catch({}),
  people: z.record(z.string(), z.number().min(0).max(200)).catch({}),
});

export type AudioPreferences = z.infer<typeof schema>;
type AudioSettings = AudioPreferences & {
  update: (prefs: Partial<AudioPreferences>) => void;
  setPersonVolume: (id: bigint, volume: number) => void;
  togglePersonMute: (id: bigint) => void;
};

export const useAudioSettings = create<AudioSettings>()(
  persist(
    (set) => ({
      ...audioDefaults,
      people: {},
      mutedPeople: {},
      update: (prefs) => set(prefs),
      setPersonVolume: (id, volume) =>
        set(({ people }) => ({ people: { ...people, [id.toString()]: volume } })),
      togglePersonMute: (id) =>
        set(({ mutedPeople }) => {
          const key = id.toString();
          return { mutedPeople: { ...mutedPeople, [key]: !mutedPeople[key] } };
        }),
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

export function isParticipantMuted(prefs: AudioPreferences, userId?: bigint) {
  return userId !== undefined && (prefs.mutedPeople[userId.toString()] ?? false);
}
