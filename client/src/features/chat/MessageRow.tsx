import { useState } from "react";

import { Avatar } from "../../components/Avatar";
import { Markdown } from "../../components/Markdown";
import { type ChatMessage, useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { Attachment } from "../attachments/Attachment";
import { ReactionChipButton } from "../reactions/ReactionChipButton";
import { ReactionPicker } from "../reactions/ReactionPicker";
import { messageDomId } from "./jumpTo";
import { ReplyQuote } from "./ReplyQuote";

export function MessageRow({
  m,
  mine,
  conversationId,
}: {
  m: ChatMessage;
  mine: boolean;
  conversationId: bigint;
}) {
  const ws = useConnection((s) => s.ws);
  const { edit, remove, setReplyingTo } = useChat();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const canChange = mine && !m.pending && m.id !== 0n && !!ws;
  const canReact = !m.pending && m.id !== 0n && !!ws;

  async function save() {
    if (!ws) return;
    const text = draft.trim();
    if (!text || text === m.text) {
      setEditing(false);
      return;
    }
    if (await edit(ws, m.id, text)) setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-[75%] space-y-1">
          <textarea
            autoFocus
            value={draft}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
            className="w-full resize-none rounded-lg bg-zinc-800 px-3 py-1.5 text-sm outline-none ring-2 ring-brand"
          />
          <p className="text-right text-xs text-zinc-500">Enter to save · Esc to cancel</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className={`flex w-full items-center gap-2 ${mine ? "justify-end" : ""}`}>
        {!mine && <Avatar userId={m.authorId} size="xs" />}
        {mine && canReact && <ReactionPicker messageId={m.id} />}
        {canReact && (
          <div className="hidden gap-1 text-xs text-zinc-400 group-hover:flex">
            <button
              onClick={() => setReplyingTo(m.id)}
              className="rounded px-1.5 py-0.5 hover:bg-zinc-800 hover:text-zinc-100"
            >
              Reply
            </button>
            {canChange && (
              <>
                <button
                  onClick={() => {
                    setDraft(m.text);
                    setEditing(true);
                  }}
                  className="rounded px-1.5 py-0.5 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  Edit
                </button>
                <button
                  onClick={() =>
                    window.confirm("Delete this message? This can't be undone.") &&
                    void remove(ws, m.id)
                  }
                  className="rounded px-1.5 py-0.5 hover:bg-zinc-800 hover:text-red-400"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}
        <div
          id={m.id !== 0n ? messageDomId(m.id) : undefined}
          className={`max-w-[75%] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-sm ${
            mine ? "bg-brand text-zinc-950" : "bg-zinc-800"
          } ${m.pending ? "opacity-50" : ""} ${m.failed ? "ring-2 ring-red-500" : ""}`}
          title={m.pending ? "sending…" : `seq ${m.seq}`}
        >
          {m.replyTo !== undefined && (
            <ReplyQuote conversationId={conversationId} replyTo={m.replyTo} mine={mine} />
          )}
          <Markdown text={m.text} />
          {m.attachments?.map((a) => (
            <Attachment key={a.id.toString()} a={a} mine={mine} />
          ))}
          {m.editedAt ? (
            <span
              className={`ml-1.5 text-[10px] ${mine ? "text-zinc-800" : "text-zinc-500"}`}
              title={new Date(Number(m.editedAt)).toLocaleString()}
            >
              (edited)
            </span>
          ) : null}
        </div>
        {!mine && canReact && <ReactionPicker messageId={m.id} />}
      </div>
      {m.reactions?.length ? (
        <div className={`mt-0.5 flex flex-wrap gap-1 ${mine ? "justify-end" : "pl-8"}`}>
          {m.reactions.map((r) => (
            <ReactionChipButton key={r.emoji} messageId={m.id} r={r} disabled={!canReact} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
