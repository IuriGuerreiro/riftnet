import { useEffect, useState } from "react";

import { codepoints } from "./sets";
import subset from "./subset.json";

export interface EmojiEntry {
  unicode: string;
  hexcode: string;
  label: string;
  group: number;
  tags: string[];
  shortcodes: string[];
}

export interface EmojiIndex {
  list: EmojiEntry[];
  byKey: Map<string, EmojiEntry>;
  byShortcode: Map<string, EmojiEntry>;
}

export const GROUPS = [
  { id: 0, label: "Smileys" },
  { id: 1, label: "People" },
  { id: 3, label: "Nature" },
  { id: 4, label: "Food" },
  { id: 5, label: "Travel" },
  { id: 6, label: "Activities" },
  { id: 7, label: "Objects" },
  { id: 8, label: "Symbols" },
] as const;

export function emojiKey(unicode: string) {
  return codepoints(unicode)
    .filter((c) => c !== "fe0f")
    .join("-");
}

let index: EmojiIndex | null = null;
let pending: Promise<EmojiIndex> | null = null;

export function loadEmojiIndex(): Promise<EmojiIndex> {
  if (index) return Promise.resolve(index);
  pending ??= Promise.resolve(subset).then((list: EmojiEntry[]) => {
    const byKey = new Map(list.map((e) => [emojiKey(e.unicode), e]));
    const byShortcode = new Map(list.flatMap((e) => e.shortcodes.map((s) => [s, e] as const)));
    index = { list, byKey, byShortcode };
    return index;
  });
  return pending;
}

export function useEmojiIndex(): EmojiIndex | null {
  const [value, setValue] = useState(index);
  useEffect(() => {
    if (value) return;
    let live = true;
    void loadEmojiIndex().then((i) => {
      if (live) setValue(i);
    });
    return () => {
      live = false;
    };
  }, [value]);
  return value;
}

export function searchEmoji(i: EmojiIndex, query: string, limit = 60): EmojiEntry[] {
  const q = query.toLowerCase().replaceAll(":", "").trim();
  if (!q) return [];
  const scored: [number, EmojiEntry][] = [];
  for (const e of i.list) {
    let score = -1;
    if (e.shortcodes.includes(q)) score = 0;
    else if (e.shortcodes.some((s) => s.startsWith(q))) score = 1;
    else if (e.label.startsWith(q)) score = 2;
    else if (e.shortcodes.some((s) => s.includes(q)) || e.label.includes(q)) score = 3;
    else if (e.tags.some((t) => t.startsWith(q))) score = 4;
    if (score >= 0) scored.push([score, e]);
  }
  return scored
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map(([, e]) => e);
}

const RECENT_KEY = "adept.recentEmoji";
const DEFAULT_RECENT = ["👍", "❤️", "😂", "🔥", "💀", "😭", "👀", "🎉", "✨", "🙏", "😅", "🤝"];

export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "null") as unknown;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
  } catch {
    return DEFAULT_RECENT;
  }
  return DEFAULT_RECENT;
}

export function pushRecent(emoji: string) {
  const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, 18);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}
