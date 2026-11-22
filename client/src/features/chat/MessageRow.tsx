import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { Avatar } from "../../components/Avatar";
import { Markdown } from "../../components/Markdown";
import { ConfirmDialog } from "../../components/ui";
import { cn } from "../../components/ui/cn";
import { formatClock, formatStamp } from "../../lib/time";
import { type ChatMessage, useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { useProfiles } from "../../stores/profiles";
import { Attachment } from "../attachments/Attachment";
import { ProfileTrigger } from "../profile/ProfileTrigger";
import { ReactionChipButton } from "../reactions/ReactionChipButton";
import { useNameFor } from "../session/useRealtime";
import { messageDomId } from "./jumpTo";
import { MessageEditor } from "./MessageEditor";
import { MessageToolbar } from "./MessageToolbar";
import { ReplyQuote } from "./ReplyQuote";

export function MessageRow({
  m,
  mine,
  header,
  time,
  conversationId,
}: {
  m: ChatMessage;
  mine: boolean;
  header: boolean;
  time: Date;
  conversationId: bigint;
}) {
  const ws = useConnection((s) => s.ws);
  const { edit, remove, setReplyingTo } = useChat();
  const nameFor = useNameFor();
  const hasProfile = useProfiles((s) => !!s.byId[m.authorId.toString()]);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const live = !m.pending && m.id !== 0n && !!ws;
  const canChange = mine && live;

  async function save(draft: string) {
    if (!ws) return;
    const text = draft.trim();
    if (!text || text === m.text) {
      setEditing(false);
      return;
    }
    if (await edit(ws, m.id, text)) setEditing(false);
  }

  return (
    <div
      id={m.id !== 0n ? messageDomId(m.id) : undefined}
      className={cn(
        "group relative flex gap-4 px-4 py-0.5 transition-colors hover:bg-surface-2",
        header && "mt-4",
        editing && "bg-surface-2",
      )}
    >
      <div className="w-10 shrink-0">
        {header ? (
          <span className={m.replyTo !== undefined ? "mt-6 block" : "mt-0.5 block"}>
            <ProfileTrigger
              userId={m.authorId}
              label={nameFor(m.authorId)}
              className="rounded-full"
            >
              <Avatar userId={m.authorId} size="md" />
            </ProfileTrigger>
          </span>
        ) : (
          <time
            dateTime={time.toISOString()}
            title={formatStamp(time)}
            className="block pt-1 text-right text-[11px] text-fg-subtle opacity-0 group-hover:opacity-100"
          >
            {formatClock(time)}
          </time>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {m.replyTo !== undefined && (
          <ReplyQuote conversationId={conversationId} replyTo={m.replyTo} />
        )}
        {header && (
          <p className="flex items-baseline gap-2">
            <ProfileTrigger
              userId={m.authorId}
              className={cn(
                "font-semibold hover:underline",
                hasProfile ? "text-fg" : "text-fg-muted",
              )}
            >
              {nameFor(m.authorId)}
            </ProfileTrigger>
            <time dateTime={time.toISOString()} className="text-xs text-fg-subtle">
              {formatStamp(time)}
            </time>
          </p>
        )}

        {editing ? (
          <MessageEditor
            initial={m.text}
            onSave={(t) => void save(t)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div
            className={cn(
              "whitespace-pre-wrap break-words text-[15px] leading-relaxed text-fg",
              m.pending && "text-fg-subtle",
              m.failed && "text-danger",
            )}
          >
            <Markdown text={m.text} />
            {m.editedAt ? (
              <span
                className="ml-1 text-[11px] text-fg-subtle"
                title={new Date(Number(m.editedAt)).toLocaleString()}
              >
                (edited)
              </span>
            ) : null}
          </div>
        )}

        {m.attachments?.length ? (
          <div className="max-w-md">
            {m.attachments.map((a) => (
              <Attachment key={a.id.toString()} a={a} mine={false} />
            ))}
          </div>
        ) : null}

        {m.failed && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-danger">
            <RotateCcw size={12} /> Message failed to send.
          </p>
        )}

        {m.reactions?.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <ReactionChipButton key={r.emoji} messageId={m.id} r={r} disabled={!live} />
            ))}
          </div>
        ) : null}
      </div>

      {live && !editing && (
        <MessageToolbar
          messageId={m.id}
          canChange={canChange}
          onReply={() => setReplyingTo(m.id)}
          onEdit={() => setEditing(true)}
          onDelete={() => setConfirmDelete(true)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete message"
        confirmLabel="Delete"
        danger
        onConfirm={() => ws && void remove(ws, m.id)}
        onClose={() => setConfirmDelete(false)}
      >
        Are you sure you want to delete this message? This can't be undone.
      </ConfirmDialog>
    </div>
  );
}
