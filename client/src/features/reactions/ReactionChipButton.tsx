import { useState } from "react";

import { useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { fromProto, nameOf, useProfiles } from "../../stores/profiles";
import { type ReactionChip, reactorsText } from "../../stores/reactions";

export function ReactionChipButton({
  messageId,
  r,
  disabled,
}: {
  messageId: bigint;
  r: ReactionChip;
  disabled: boolean;
}) {
  const ws = useConnection((s) => s.ws);
  const { toggleReaction, reactors } = useChat();
  const members = useChat((s) => s.conversations.find((c) => c.id === s.selected)?.members ?? []);
  const profiles = useProfiles((s) => s.byId);
  const [who, setWho] = useState<{ count: number; ids: bigint[] } | null>(null);

  async function loadWho() {
    if (!ws || who?.count === r.count) return;
    try {
      setWho({ count: r.count, ids: await reactors(ws, messageId, r.emoji) });
    } catch {
      setWho(null);
    }
  }
  const names = (who?.ids ?? []).map((id) => {
    const member = members.find((u) => u.id === id);
    return member ? nameOf(fromProto(member)) : nameOf(profiles[id.toString()]);
  });

  return (
    <button
      disabled={disabled}
      onMouseEnter={() => void loadWho()}
      onFocus={() => void loadWho()}
      onClick={() => ws && void toggleReaction(ws, messageId, r.emoji)}
      title={names.length ? `${reactorsText(names, r.count)} reacted with ${r.emoji}` : r.emoji}
      aria-pressed={r.me}
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        r.me
          ? "border-brand bg-brand/15 text-zinc-100"
          : "border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:border-zinc-500"
      }`}
    >
      <span className="text-sm">{r.emoji}</span>
      <span>{r.count}</span>
    </button>
  );
}
