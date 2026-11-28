import { useSyncExternalStore } from "react";

export const EMOJI_SETS = [
  { id: "fluent-3d", label: "Fluent 3D" },
  { id: "fluent-flat", label: "Fluent Flat" },
  { id: "twemoji", label: "Twemoji" },
  { id: "openmoji", label: "OpenMoji" },
  { id: "native", label: "System" },
] as const;

export type EmojiSet = (typeof EMOJI_SETS)[number]["id"];

const KEY = "riftnet.emojiSet";
const listeners = new Set<() => void>();

function read(): EmojiSet {
  try {
    const v = localStorage.getItem(KEY);
    if (EMOJI_SETS.some((s) => s.id === v)) return v as EmojiSet;
  } catch {
    return "fluent-3d";
  }
  return "fluent-3d";
}

let current: EmojiSet = read();

export function setEmojiSet(set: EmojiSet) {
  current = set;
  try {
    localStorage.setItem(KEY, set);
  } catch {
    // INVARIANT: storage is optional; the choice still applies for this session.
  }
  for (const l of listeners) l();
}

export function useEmojiSet(): EmojiSet {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

const CDN = "https://cdn.jsdelivr.net";

export function codepoints(unicode: string): string[] {
  return Array.from(unicode, (c) => (c.codePointAt(0) ?? 0).toString(16));
}

export function emojiUrl(set: EmojiSet, unicode: string, hexcode: string): string | null {
  const cps = codepoints(unicode);
  switch (set) {
    case "fluent-3d":
      return `${CDN}/npm/@lobehub/fluent-emoji-3d@1.1.0/assets/${cps.join("-")}.webp`;
    case "fluent-flat":
      return `${CDN}/npm/@lobehub/fluent-emoji-flat@1.1.0/assets/${cps.join("-")}.svg`;
    case "twemoji": {
      const parts = cps.includes("200d") ? cps : cps.filter((c) => c !== "fe0f");
      return `${CDN}/gh/jdecked/twemoji@15.1.0/assets/svg/${parts.join("-")}.svg`;
    }
    case "openmoji":
      return `${CDN}/npm/openmoji@17.0.0/color/svg/${hexcode.toUpperCase()}.svg`;
    default:
      return null;
  }
}
