import { CornerUpLeft, SmilePlus } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Emoji } from "@/features/emoji/Emoji";
import { EmojiPicker } from "@/features/emoji/EmojiPicker";
import { EmojiText, isOnlyEmoji } from "@/features/emoji/EmojiText";
import { Attachments } from "@/features/media/Attachments";
import { cn } from "@/lib/utils";
import { ME, type Message, type Reaction, user } from "@/mock/data";

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

function renderMentions(chunk: string, key: string) {
  return chunk.split(/(@\w+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={`${key}-${i}`} className="rounded bg-brand/20 px-0.5 font-medium text-brand">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

const QUICK = ["👍", "😂", "🔥"];

function ReplyQuote({ target }: { target?: Message }) {
  if (!target) return null;
  return (
    <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
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
    </div>
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

function MessageBody({ m, all }: { m: Message; all: Message[] }) {
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
      className={cn(
        "group/msg relative -mx-4 px-4 py-0.5 hover:bg-white/[0.025]",
        mentioned && "border-l-2 border-brand bg-brand/[0.07] hover:bg-brand/10",
        picker && "bg-white/[0.025]",
      )}
    >
      {m.replyTo && <ReplyQuote target={all.find((x) => x.id === m.replyTo)} />}
      {m.text && (
        <p className="text-[15px] leading-relaxed text-foreground/90">
          <EmojiText text={m.text} size={jumbo ? 44 : 20} renderText={renderMentions} />
        </p>
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
          picker === "toolbar" ? "flex" : "hidden group-hover/msg:flex",
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
        <button
          type="button"
          aria-label="Reply"
          className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <CornerUpLeft className="size-[18px]" />
        </button>
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
}: {
  messages: Message[];
  compact?: boolean;
  unread?: number;
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
              {g.items.map((m) => (
                <div key={m.id}>
                  {m.id === firstUnread && m.id !== g.items[0]?.id && (
                    <div className="py-2">
                      <NewDivider />
                    </div>
                  )}
                  <MessageBody m={m} all={messages} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
