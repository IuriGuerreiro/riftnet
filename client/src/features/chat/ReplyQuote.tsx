import { useState } from "react";

import { replyTarget, useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { nameOf, useProfiles } from "../../stores/profiles";
import { jumpTo } from "./jumpTo";

export function ReplyQuote({
  conversationId,
  replyTo,
  mine,
}: {
  conversationId: bigint;
  replyTo: bigint;
  mine: boolean;
}) {
  const ws = useConnection((s) => s.ws);
  const k = conversationId.toString();
  const messages = useChat((s) => s.messages[k]) ?? [];
  const deleted = useChat((s) => s.deleted[k]);
  const loadUntil = useChat((s) => s.loadUntil);
  const profiles = useProfiles((s) => s.byId);
  const [gone, setGone] = useState(false);
  const target = gone ? ({ state: "deleted" } as const) : replyTarget(messages, deleted, replyTo);
  const muted = mine ? "text-zinc-800" : "text-zinc-400";

  if (target.state === "deleted")
    return <span className={`mb-1 block text-xs italic ${muted}`}>↪ Original deleted</span>;

  return (
    <button
      type="button"
      onClick={async () => {
        if (jumpTo(replyTo) || !ws) return;
        if (await loadUntil(ws, conversationId, replyTo)) setTimeout(() => jumpTo(replyTo), 50);
        else setGone(true);
      }}
      className={`mb-1 block max-w-full truncate border-l-2 border-current pl-2 text-left text-xs hover:underline ${muted}`}
    >
      {target.state === "loaded" ? (
        <>
          <span className="font-semibold">
            {nameOf(profiles[target.message.authorId.toString()])}
          </span>{" "}
          {target.message.text || "📎 attachment"}
        </>
      ) : (
        "↪ Earlier message · click to load"
      )}
    </button>
  );
}
