import { useState } from "react";

import { replyTarget, useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { nameOf, useProfiles } from "../../stores/profiles";
import { jumpTo } from "./jumpTo";

export function ReplyQuote({
  conversationId,
  replyTo,
}: {
  conversationId: bigint;
  replyTo: bigint;
}) {
  const ws = useConnection((s) => s.ws);
  const k = conversationId.toString();
  const messages = useChat((s) => s.messages[k]) ?? [];
  const deleted = useChat((s) => s.deleted[k]);
  const loadUntil = useChat((s) => s.loadUntil);
  const profiles = useProfiles((s) => s.byId);
  const [gone, setGone] = useState(false);
  const target = gone ? ({ state: "deleted" } as const) : replyTarget(messages, deleted, replyTo);
  const muted = "text-fg-muted";

  if (target.state === "deleted")
    return <span className={`mb-1 block text-xs italic ${muted}`}>↪ Original message deleted</span>;

  return (
    <button
      type="button"
      onClick={async () => {
        if (jumpTo(replyTo) || !ws) return;
        if (await loadUntil(ws, conversationId, replyTo)) setTimeout(() => jumpTo(replyTo), 50);
        else setGone(true);
      }}
      className={`relative mb-1 ml-[-2.25rem] block max-w-full truncate pl-9 text-left text-xs before:absolute before:left-[0.9rem] before:top-1/2 before:h-2.5 before:w-5 before:rounded-tl-md before:border-l-2 before:border-t-2 before:border-line-strong hover:text-fg ${muted}`}
    >
      {target.state === "loaded" ? (
        <>
          <span className="font-semibold">
            {nameOf(profiles[target.message.authorId.toString()])}
          </span>{" "}
          {target.message.text || "Attachment"}
        </>
      ) : (
        "↪ Earlier message · Click to load"
      )}
    </button>
  );
}
