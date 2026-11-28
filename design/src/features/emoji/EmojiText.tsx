import type { ReactNode } from "react";

import { useEmojiIndex } from "./data";
import { Emoji } from "./Emoji";

const EMOJI_RE =
  /(\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️|⃣)*(?:‍\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️)*)*|:[a-z0-9_+-]+:)/gu;

export function isOnlyEmoji(text: string) {
  const stripped = text.replaceAll(EMOJI_RE, "").trim();
  const count = text.match(EMOJI_RE)?.length ?? 0;
  return stripped === "" && count > 0 && count <= 12;
}

export function EmojiText({
  text,
  size = 20,
  renderText,
}: {
  text: string;
  size?: number;
  renderText?: (chunk: string, key: string) => ReactNode;
}) {
  const index = useEmojiIndex();
  const parts = text.split(EMOJI_RE);
  return (
    <>
      {parts.map((part, i) => {
        const key = `${i}:${part}`;
        if (i % 2 === 0) return renderText ? renderText(part, key) : part;
        if (part.startsWith(":")) {
          const entry = index?.byShortcode.get(part.slice(1, -1));
          return entry ? (
            <Emoji key={key} emoji={entry.unicode} size={size} className="mx-px" />
          ) : (
            part
          );
        }
        return <Emoji key={key} emoji={part} size={size} className="mx-px" />;
      })}
    </>
  );
}
