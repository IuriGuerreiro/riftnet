import { CornerUpLeft, Play, SmilePlus } from "lucide-react";

import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { ME, type Message, user } from "@/mock/data";

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

function renderText(text: string) {
  return text.split(/(@\w+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="rounded bg-brand/20 px-0.5 font-medium text-brand">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function ReplyQuote({ target }: { target?: Message }) {
  if (!target) return null;
  return (
    <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      <CornerUpLeft className="size-3 -scale-x-100" />
      <Avatar id={target.author} size={14} />
      <span className="font-medium text-foreground/80">{user(target.author).name}</span>
      <span className="truncate">{target.text}</span>
    </div>
  );
}

function MessageBody({ m, all }: { m: Message; all: Message[] }) {
  const mentioned = m.text.includes(`@${user(ME).handle}`);
  return (
    <div
      className={cn(
        "group/msg relative -mx-4 px-4 py-0.5 hover:bg-white/[0.025]",
        mentioned && "border-l-2 border-brand bg-brand/[0.07] hover:bg-brand/10",
      )}
    >
      {m.replyTo && <ReplyQuote target={all.find((x) => x.id === m.replyTo)} />}
      <p className="text-[15px] leading-relaxed text-foreground/90">{renderText(m.text)}</p>
      {m.image && (
        <div
          className="relative mt-2 grid max-w-md place-items-center overflow-hidden rounded-xl border border-white/5"
          style={{
            aspectRatio: m.image.ratio,
            background:
              "radial-gradient(circle at 30% 30%, hsl(262 50% 35%), transparent 60%), radial-gradient(circle at 75% 70%, hsl(200 50% 28%), transparent 55%), var(--surface-2)",
          }}
        >
          {m.image.label.endsWith(".mp4") || m.image.label.includes(".mp4") ? (
            <span className="grid size-12 place-items-center rounded-full bg-black/40 backdrop-blur">
              <Play className="size-5 fill-white text-white" />
            </span>
          ) : null}
          <span className="absolute bottom-2 left-2 rounded-md bg-black/50 px-2 py-0.5 text-[11px] text-white/80 backdrop-blur">
            {m.image.label}
          </span>
        </div>
      )}
      {m.reactions && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {m.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              className={cn(
                "flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors",
                r.mine
                  ? "border-brand/50 bg-brand/15 text-foreground"
                  : "border-border bg-surface-2 text-muted-foreground hover:border-surface-4",
              )}
            >
              <span>{r.emoji}</span>
              <span className="font-medium">{r.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="absolute -top-3 right-4 hidden items-center rounded-lg border border-border bg-popover p-0.5 shadow-lg group-hover/msg:flex">
        <button
          type="button"
          aria-label="React"
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <SmilePlus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Reply"
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <CornerUpLeft className="size-4" />
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
