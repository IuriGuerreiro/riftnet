import type { Reaction, ReactionUpdated } from "../gen/v1/messages_pb";

export interface ReactionChip {
  emoji: string;
  count: number;
  me: boolean;
}

export const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👀"];

export const fromProto = (rs: Reaction[]): ReactionChip[] =>
  rs.map((r) => ({ emoji: r.emoji, count: r.count, me: r.me }));

// INVARIANT: `count` is absolute, so applying the same push twice is harmless.
export function applyReaction(
  chips: ReactionChip[] | undefined,
  ev: Pick<ReactionUpdated, "emoji" | "count" | "added" | "userId">,
  myId: bigint,
): ReactionChip[] {
  const list = chips ?? [];
  const old = list.find((c) => c.emoji === ev.emoji);
  if (ev.count === 0) return list.filter((c) => c.emoji !== ev.emoji);
  const me = ev.userId === myId ? ev.added : (old?.me ?? false);
  const next = { emoji: ev.emoji, count: ev.count, me };
  return old ? list.map((c) => (c === old ? next : c)) : [...list, next];
}

export function reactorsText(names: string[], total: number): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, 3);
  const rest = Math.max(total, names.length) - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
  if (shown.length === 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown.slice(-1).join("")}`;
}
