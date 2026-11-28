import { useState } from "react";

import { cn } from "@/lib/utils";

import { emojiKey, useEmojiIndex } from "./data";
import { emojiUrl, useEmojiSet } from "./sets";

export function Emoji({
  emoji,
  size = 20,
  className,
  onUnavailable,
}: {
  emoji: string;
  size?: number;
  className?: string;
  onUnavailable?: () => void;
}) {
  const set = useEmojiSet();
  const index = useEmojiIndex();
  const [failed, setFailed] = useState<string[]>([]);
  const entry = index?.byKey.get(emojiKey(emoji));
  const candidates = entry
    ? [
        emojiUrl(set, entry.unicode, entry.hexcode),
        emojiUrl("twemoji", entry.unicode, entry.hexcode),
      ]
    : [];
  const src = candidates.find((u): u is string => u !== null && !failed.includes(u));
  const title = entry?.shortcodes[0] ? `:${entry.shortcodes[0]}:` : entry?.label;

  if (set === "native" || !src) {
    return (
      <span
        role="img"
        aria-label={entry?.label ?? emoji}
        title={title}
        className={cn("inline-block shrink-0 text-center leading-none", className)}
        style={{ fontSize: size * 0.9, width: size, height: size, lineHeight: `${size}px` }}
      >
        {emoji}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={emoji}
      title={title}
      draggable={false}
      loading="lazy"
      onError={() => {
        const next = [...failed, src];
        setFailed(next);
        if (!candidates.some((u) => u !== null && !next.includes(u))) onUnavailable?.();
      }}
      className={cn("inline-block shrink-0 object-contain align-[-0.2em] select-none", className)}
      style={{ width: size, height: size }}
    />
  );
}
