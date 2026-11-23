import { CornerUpLeft, Pencil, SmilePlus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Emoji } from "@/features/emoji/Emoji";
import { EmojiPicker } from "@/features/emoji/EmojiPicker";
import { EmojiText, isOnlyEmoji } from "@/features/emoji/EmojiText";
import { Attachments } from "@/features/media/Attachments";
import { cn } from "@/lib/utils";
import { ME, type Message, type Reaction, user } from "@/mock/data";

import { Markdown } from "./Markdown";
import { MessageEditor } from "./MessageEditor";

interface Group {
  author: string;
  time: string;
  items: Message[];
}

function group(messages: Message[]): Group[] {
  const out: Group[] = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (last?.author === m.author && !m.replyTo) last.items.push(m);
    else out.push({ author: m.author, time: m.time, items: [m] });
  }
  return out;
}

const QUICK = ["👍", "😂", "🔥"];

export interface MessageActions {
  reply: (id: string) => void;
  startEdit: (id: string) => void;
  saveEdit: (id: string, text: string) => void;
  cancelEdit: () => void;
  remove: (id: string, skipConfirm: boolean) => void;
  jumpTo: (id: string) => void;
}

function ToolButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent",
        danger ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ReplyQuote({ target, onJump }: { target?: Message; onJump: (id: string) => void }) {
  if (!target) {
    return (
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground italic">
        <CornerUpLeft className="size-3 -scale-x-100" />
        Original message was deleted
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onJump(target.id)}
      className="mb-1 flex max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
    >
      <CornerUpLeft className="size-3 -scale-x-100" />
      <Avatar id={target.author} size={14} />
      <span className="font-medium text-foreground/80">{user(target.author).name}</span>
      <span className="truncate">
        {target.text ? (
          <EmojiText text={target.text} size={14} />
        ) : (
          <span className="italic">Attachment</span>
        )}
      </span>
    </button>
  );
}

function ReactionChip({ r, onToggle }: { r: Reaction; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={r.mine}
      className={cn(
        "group/chip flex h-7 items-center gap-1.5 rounded-lg border px-2 transition-all duration-150 active:scale-90",
        r.mine
          ? "border-brand/45 bg-brand/15 text-foreground"
          : "border-transparent bg-surface-2 text-muted-foreground hover:border-surface-4 hover:text-foreground",
      )}
    >
      <Emoji
        emoji={r.emoji}
        size={18}
        className="transition-transform group-hover/chip:scale-110"
      />
      <span className="text-[13px] font-semibold tabular-nums">{r.count}</span>
    </button>
  );
}

function PickerButton({
  open,
  onOpenChange,
  onPick,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (e: string) => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-auto p-0">
        <EmojiPicker
          onPick={(e) => {
            onPick(e);
            onOpenChange(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function MessageBody({
  m,
  all,
  editing,
  flash,
  actions,
  showTime,
}: {
  m: Message;
  all: Message[];
  editing: boolean;
  flash: boolean;
  actions: MessageActions;
  showTime: boolean;
}) {
  const mine = m.author === ME;
  const mentioned = m.text.includes(`@${user(ME).handle}`);
  const [reactions, setReactions] = useState<Reaction[]>(m.reactions ?? []);
  const [picker, setPicker] = useState<"toolbar" | "row" | null>(null);
  const jumbo = isOnlyEmoji(m.text);

  const toggle = (emoji: string) =>
    setReactions((rs) => {
      const hit = rs.find((r) => r.emoji === emoji);
      if (!hit) return [...rs, { emoji, count: 1, mine: true }];
      const count = hit.count + (hit.mine ? -1 : 1);
      if (count <= 0) return rs.filter((r) => r !== hit);
      return rs.map((r) => (r === hit ? { ...r, count, mine: !r.mine } : r));
    });
  const add = (emoji: string) => {
    if (!reactions.some((r) => r.emoji === emoji && r.mine)) toggle(emoji);
  };

  return (
    <div
      id={`msg-${m.id}`}
      className={cn(
        "group/msg relative -mx-4 px-4 py-0.5 transition-colors duration-700 hover:bg-white/[0.025]",
        mentioned && "border-l-2 border-brand bg-brand/[0.07] hover:bg-brand/10",
        (picker !== null || editing) && "bg-white/[0.025]",
        flash && "bg-brand/15 duration-150",
      )}
    >
      {showTime && (
        <span className="absolute top-1.5 -left-[38px] hidden w-[44px] text-center text-[10px] text-muted-foreground/70 tabular-nums group-hover/msg:block">
          {m.time}
        </span>
      )}
      {m.replyTo && (
        <ReplyQuote target={all.find((x) => x.id === m.replyTo)} onJump={actions.jumpTo} />
      )}
      {editing ? (
        <MessageEditor
          initial={m.text}
          onCancel={actions.cancelEdit}
          onSave={(t) => (t ? actions.saveEdit(m.id, t) : actions.remove(m.id, false))}
        />
      ) : (
        m.text && (
          <div className="text-[15px] leading-relaxed text-foreground/90">
            {jumbo ? (
              <EmojiText text={m.text} size={44} />
            ) : (
              <Markdown
                text={m.text}
                suffix={
                  m.edited ? (
                    <span className="ml-1 text-[11px] text-muted-foreground" title="Edited">
                      (edited)
                    </span>
                  ) : undefined
                }
              />
            )}
          </div>
        )
      )}
      {m.attachments && <Attachments items={m.attachments} author={m.author} time={m.time} />}
      {reactions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {reactions.map((r) => (
            <ReactionChip key={r.emoji} r={r} onToggle={() => toggle(r.emoji)} />
          ))}
          <PickerButton
            open={picker === "row"}
            onOpenChange={(v) => setPicker(v ? "row" : null)}
            onPick={add}
          >
            <button
              type="button"
              aria-label="Add reaction"
              className={cn(
                "grid h-7 w-8 place-items-center rounded-lg bg-surface-2 text-muted-foreground transition-opacity hover:text-foreground",
                picker === "row" ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100",
              )}
            >
              <SmilePlus className="size-4" />
            </button>
          </PickerButton>
        </div>
      )}
      <div
        className={cn(
          "absolute -top-4 right-4 items-center gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-lg shadow-black/30",
          picker === "toolbar" ? "flex" : editing ? "hidden" : "hidden group-hover/msg:flex",
        )}
      >
        {QUICK.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={`React ${e}`}
            onClick={() => add(e)}
            className="grid size-8 place-items-center rounded-lg transition-transform hover:scale-110 hover:bg-accent"
          >
            <Emoji emoji={e} size={20} />
          </button>
        ))}
        <span className="mx-0.5 h-5 w-px bg-border" />
        <PickerButton
          open={picker === "toolbar"}
          onOpenChange={(v) => setPicker(v ? "toolbar" : null)}
          onPick={add}
        >
          <button
            type="button"
            aria-label="Add reaction"
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <SmilePlus className="size-[18px]" />
          </button>
        </PickerButton>
        <ToolButton label="Reply" onClick={() => actions.reply(m.id)}>
          <CornerUpLeft className="size-[18px]" />
        </ToolButton>
        {mine && m.text && (
          <ToolButton label="Edit" onClick={() => actions.startEdit(m.id)}>
            <Pencil className="size-[17px]" />
          </ToolButton>
        )}
        {mine && (
          <ToolButton
            label="Delete (Shift to skip confirm)"
            danger
            onClick={(e) => actions.remove(m.id, e.shiftKey)}
          >
            <Trash2 className="size-[17px]" />
          </ToolButton>
        )}
      </div>
    </div>
  );
}

function NewDivider() {
  return (
    <div className="flex items-center gap-3 text-[11px] font-semibold tracking-wider text-brand uppercase">
      <span className="h-px flex-1 bg-brand/40" />
      New messages
    </div>
  );
}

export function MessageList({
  messages,
  compact = false,
  unread = 0,
  editingId,
  flashId,
  actions,
}: {
  messages: Message[];
  compact?: boolean;
  unread?: number;
  editingId: string | null;
  flashId: string | null;
  actions: MessageActions;
}) {
  const firstUnread = unread > 0 ? messages.at(-Math.min(unread, messages.length))?.id : undefined;
  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex items-center gap-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        <span className="h-px flex-1 bg-border" />
        Today
        <span className="h-px flex-1 bg-border" />
      </div>
      {group(messages).map((g) => (
        <div key={g.items[0]?.id} className="flex flex-col gap-4">
          {g.items[0]?.id === firstUnread && <NewDivider />}
          <div className="flex gap-3">
            <Avatar id={g.author} size={compact ? 32 : 38} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[15px] font-semibold">{user(g.author).name}</span>
                <span className="text-[11px] text-muted-foreground">{g.time}</span>
              </div>
              {g.items.map((m, i) => (
                <div key={m.id}>
                  {m.id === firstUnread && m.id !== g.items[0]?.id && (
                    <div className="py-2">
                      <NewDivider />
                    </div>
                  )}
                  <MessageBody
                    m={m}
                    all={messages}
                    editing={editingId === m.id}
                    flash={flashId === m.id}
                    actions={actions}
                    showTime={i > 0}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
