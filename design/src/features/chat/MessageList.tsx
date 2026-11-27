import {
  CircleAlert,
  Copy,
  CornerUpLeft,
  EyeOff,
  Flag,
  Forward,
  Link2,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCw,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { Avatar } from "@/components/Avatar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Emoji } from "@/features/emoji/Emoji";
import { EmojiPicker } from "@/features/emoji/EmojiPicker";
import { EmojiText, isOnlyEmoji } from "@/features/emoji/EmojiText";
import { Attachments } from "@/features/media/Attachments";
import { ProfileTrigger } from "@/features/profile/ProfileCard";
import { cn } from "@/lib/utils";
import { FRIENDS, ME, type Message, type Reaction, user } from "@/mock/data";
import { useWorld, world } from "@/mock/world";

import { Embed, embedsIn } from "./Embed";
import { Markdown } from "./Markdown";
import { mentionsMe } from "./mentions";
import { MessageEditor } from "./MessageEditor";
import type { Row } from "./rows";

const QUICK = ["👍", "😂", "🔥"];

export interface MessageActions {
  forward: (m: Message) => void;
  report: (m: Message) => void;
  thread: (id: string) => void;
  reply: (id: string) => void;
  startEdit: (id: string) => void;
  saveEdit: (id: string, text: string) => void;
  cancelEdit: () => void;
  remove: (id: string, skipConfirm: boolean) => void;
  jumpTo: (id: string) => void;
  react: (id: string, emoji: string) => void;
  pin: (id: string) => void;
  markUnread: (id: string) => void;
  retry: (id: string) => void;
  copyText: (m: Message) => void;
  copyLink: (id: string) => void;
}

interface MenuItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}

function menuFor(m: Message, actions: MessageActions, openPicker: () => void): MenuItem[] {
  const mine = m.author === ME;
  const items: (MenuItem | false)[] = [
    { label: "Add reaction", icon: <SmilePlus />, onSelect: openPicker },
    { label: "Reply", icon: <CornerUpLeft />, onSelect: () => actions.reply(m.id) },
    { label: "Open thread", icon: <MessagesSquare />, onSelect: () => actions.thread(m.id) },
    !!m.text && { label: "Forward", icon: <Forward />, onSelect: () => actions.forward(m) },
    mine &&
      (!!m.text || !!m.attachments?.length) && {
        label: "Edit message",
        icon: <Pencil />,
        onSelect: () => actions.startEdit(m.id),
      },
    {
      label: m.pinned ? "Unpin message" : "Pin message",
      icon: m.pinned ? <PinOff /> : <Pin />,
      onSelect: () => actions.pin(m.id),
    },
    {
      label: "Mark unread",
      icon: <EyeOff />,
      onSelect: () => actions.markUnread(m.id),
      separatorBefore: true,
    },
    !!m.text && { label: "Copy text", icon: <Copy />, onSelect: () => actions.copyText(m) },
    { label: "Copy message link", icon: <Link2 />, onSelect: () => actions.copyLink(m.id) },
    !mine && {
      label: "Report message",
      icon: <Flag />,
      onSelect: () => actions.report(m),
      danger: true,
      separatorBefore: true,
    },
    mine && {
      label: "Delete message",
      icon: <Trash2 />,
      onSelect: () => actions.remove(m.id, false),
      danger: true,
      separatorBefore: true,
    },
  ];
  return items.filter((i): i is MenuItem => i !== false);
}

function reactors(r: Reaction, seed: string) {
  const others = FRIENDS.map((f) => f.name);
  const start = Array.from(seed).reduce((n, c) => n + c.charCodeAt(0), 0) % others.length;
  const names = Array.from(
    { length: r.count - (r.mine ? 1 : 0) },
    (_, i) => others[(start + i) % others.length] ?? "",
  );
  return r.mine ? ["You", ...names] : names;
}

function reactorText(names: string[]) {
  if (names.length <= 3) return names.join(", ").replace(/, ([^,]*)$/, " and $1");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

function ReplyQuote({ target, onJump }: { target?: Message; onJump: (id: string) => void }) {
  if (!target) {
    return (
      <div className="mb-0.5 flex items-center gap-1.5 pl-[50px] text-xs text-muted-foreground italic">
        <CornerUpLeft className="size-3 -scale-x-100" />
        Message deleted
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onJump(target.id)}
      className="relative mb-0.5 flex max-w-full items-center gap-1.5 pl-[50px] text-left text-xs text-muted-foreground before:absolute before:top-1/2 before:left-[18px] before:h-2.5 before:w-7 before:rounded-tl-md before:border-t-2 before:border-l-2 before:border-surface-4 hover:text-foreground"
    >
      <Avatar id={target.author} size={16} />
      <span className="font-semibold text-foreground/85">{user(target.author).name}</span>
      <span className="truncate">
        {target.text ? <EmojiText text={target.text} size={14} /> : <i>Attachment</i>}
      </span>
    </button>
  );
}

function ReactionChip({ r, seed, onToggle }: { r: Reaction; seed: string; onToggle: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
      </TooltipTrigger>
      <TooltipContent className="flex max-w-60 items-center gap-2">
        <Emoji emoji={r.emoji} size={28} />
        <span>{reactorText(reactors(r, seed))} reacted</span>
      </TooltipContent>
    </Tooltip>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent"
    >
      {children}
    </button>
  );
}

function ReactionPicker({
  open,
  onOpenChange,
  onPick,
  align,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (emoji: string) => void;
  align: "start" | "end";
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align={align} sideOffset={8} className="w-auto p-0">
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

function MenuRow({ item, kind }: { item: MenuItem; kind: "context" | "dropdown" }) {
  const Item = kind === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator = kind === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      {item.separatorBefore && <Separator />}
      <Item
        variant={item.danger ? "destructive" : "default"}
        onSelect={item.onSelect}
        className="justify-between"
      >
        {item.label}
        <span className="[&_svg]:size-4">{item.icon}</span>
      </Item>
    </>
  );
}

function MessageRow({
  m,
  head,
  all,
  editing,
  flash,
  last,
  actions,
}: {
  m: Message;
  head: boolean;
  all: Message[];
  editing: boolean;
  flash: boolean;
  last: boolean;
  actions: MessageActions;
}) {
  const mine = m.author === ME;
  const mentioned = mentionsMe(m.text);
  const reactions = m.reactions ?? [];
  const [picker, setPicker] = useState<"toolbar" | "row" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const jumbo = isOnlyEmoji(m.text);
  const embeds = m.text && world.settings.embeds ? embedsIn(m.text) : [];
  const menu = menuFor(m, actions, () => requestAnimationFrame(() => setPicker("toolbar")));

  const toggle = (emoji: string) => actions.react(m.id, emoji);
  const add = (emoji: string) => {
    if (!reactions.some((r) => r.emoji === emoji && r.mine)) toggle(emoji);
  };
  const toolbarPinned = picker === "toolbar" || menuOpen;

  useWorld();
  const [shown, setShown] = useState(false);
  const replies = world.threads[m.id]?.length ?? 0;
  if (m.system)
    return (
      <p
        id={`msg-${m.id}`}
        className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground"
      >
        <span className="h-px w-6 bg-border" />
        {m.text} · {m.time}
      </p>
    );
  if (world.blocked.has(m.author) && !shown)
    return (
      <p className="px-4 py-1 text-xs text-muted-foreground">
        Message from someone you blocked.{" "}
        <button type="button" onClick={() => setShown(true)} className="font-medium underline">
          Show
        </button>
      </p>
    );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={editing || m.status !== undefined}>
        <div
          id={`msg-${m.id}`}
          data-message
          tabIndex={last ? 0 : -1}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            const rows = [
              ...(e.currentTarget
                .closest("[data-messages]")
                ?.querySelectorAll<HTMLElement>("[data-message]") ?? []),
            ];
            rows[rows.indexOf(e.currentTarget) + (e.key === "ArrowUp" ? -1 : 1)]?.focus();
          }}
          className={cn(
            "group/msg relative px-4 outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset transition-colors duration-700 hover:bg-white/[0.025]",
            head ? "mt-3 pt-1 pb-0.5 [.compact_&]:mt-1" : "py-0.5 [.compact_&]:py-0",
            mentioned &&
              "bg-brand/[0.07] shadow-[inset_2px_0_0_var(--adept-violet)] hover:bg-brand/10",
            (picker !== null || editing || menuOpen) && "bg-white/[0.025]",
            flash && "bg-brand/15 duration-150",
          )}
        >
          {m.replyTo && head && (
            <ReplyQuote target={all.find((x) => x.id === m.replyTo)} onJump={actions.jumpTo} />
          )}
          <div className="flex gap-3">
            <div className="w-[38px] shrink-0">
              {head ? (
                <ProfileTrigger id={m.author} className="rounded-full">
                  <Avatar id={m.author} size={38} className="mt-0.5" />
                </ProfileTrigger>
              ) : (
                <span className="hidden pt-1 text-center text-[10px] text-muted-foreground/70 tabular-nums group-hover/msg:block">
                  {m.time}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {head && (
                <div className="flex items-baseline gap-2">
                  <ProfileTrigger
                    id={m.author}
                    className="text-[15px] font-semibold hover:underline"
                  >
                    {user(m.author).name}
                  </ProfileTrigger>
                  <span
                    title={`${m.day ?? "Today"} at ${m.time}`}
                    className="text-[11px] text-muted-foreground"
                  >
                    {m.day && m.day !== "Today" ? `${m.day} at ` : ""}
                    {m.time}
                  </span>
                  {m.pinned && (
                    <Pin className="size-3 self-center text-muted-foreground" aria-label="Pinned" />
                  )}
                </div>
              )}
              {!head && m.pinned && (
                <Pin className="size-3 text-muted-foreground" aria-label="Pinned" />
              )}
              {editing ? (
                <MessageEditor
                  initial={m.text}
                  onCancel={actions.cancelEdit}
                  onSave={(t) =>
                    t || m.attachments?.length
                      ? actions.saveEdit(m.id, t)
                      : actions.remove(m.id, false)
                  }
                />
              ) : (
                m.text && (
                  <div
                    className={cn(
                      "text-[15px] leading-relaxed text-foreground/90 [overflow-wrap:anywhere] [&_p]:whitespace-pre-wrap",
                      m.status === "sending" && "opacity-55",
                      m.status === "failed" && "text-destructive/90",
                    )}
                  >
                    {jumbo ? (
                      <>
                        <EmojiText text={m.text} size={44} />
                        {m.edited && (
                          <span className="ml-1 text-[11px] text-muted-foreground">(edited)</span>
                        )}
                      </>
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
              {m.status === "failed" && (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-destructive">
                  <CircleAlert className="size-3.5" />
                  Message failed to send.
                  <button
                    type="button"
                    onClick={() => actions.retry(m.id)}
                    className="flex items-center gap-1 font-semibold hover:underline"
                  >
                    <RotateCw className="size-3" /> Retry
                  </button>
                  ·
                  <button
                    type="button"
                    onClick={() => actions.remove(m.id, true)}
                    className="font-semibold hover:underline"
                  >
                    Delete
                  </button>
                </p>
              )}
              {m.attachments && (
                <Attachments items={m.attachments} author={m.author} time={m.time} />
              )}
              {embeds.map((e) => (
                <Embed key={e.url} e={e} />
              ))}
              {replies > 0 && (
                <button
                  type="button"
                  onClick={() => actions.thread(m.id)}
                  className="mt-1 text-xs font-medium text-brand-text hover:underline"
                >
                  {replies} {replies === 1 ? "reply" : "replies"}
                </button>
              )}
              {reactions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {reactions.map((r) => (
                    <ReactionChip
                      key={r.emoji}
                      r={r}
                      seed={`${m.id}${r.emoji}`}
                      onToggle={() => toggle(r.emoji)}
                    />
                  ))}
                  <ReactionPicker
                    open={picker === "row"}
                    onOpenChange={(v) => setPicker(v ? "row" : null)}
                    onPick={add}
                    align="start"
                  >
                    <button
                      type="button"
                      aria-label="Add reaction"
                      className={cn(
                        "grid h-7 w-8 place-items-center rounded-lg bg-surface-2 text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100",
                        picker === "row" ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100",
                      )}
                    >
                      <SmilePlus className="size-4" />
                    </button>
                  </ReactionPicker>
                </div>
              )}
            </div>
          </div>

          {!editing && m.status === undefined && (
            <div
              className={cn(
                "absolute -top-4 right-4 z-20 items-center gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-lg shadow-black/30",
                toolbarPinned
                  ? "flex"
                  : "hidden group-focus-visible/msg:flex group-has-[:focus-visible]/msg:flex group-hover/msg:flex",
              )}
            >
              {QUICK.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-label={`React ${e}`}
                  aria-pressed={reactions.some((r) => r.emoji === e && r.mine)}
                  onClick={() => toggle(e)}
                  className="grid size-8 place-items-center rounded-lg transition-transform hover:scale-110 hover:bg-accent focus-visible:bg-accent"
                >
                  <Emoji emoji={e} size={20} />
                </button>
              ))}
              <span className="mx-0.5 h-5 w-px bg-border" />
              <ReactionPicker
                open={picker === "toolbar"}
                onOpenChange={(v) => setPicker(v ? "toolbar" : null)}
                onPick={add}
                align="end"
              >
                <button
                  type="button"
                  aria-label="Add reaction"
                  title="Add reaction"
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <SmilePlus className="size-[18px]" />
                </button>
              </ReactionPicker>
              <ToolButton label="Reply" onClick={() => actions.reply(m.id)}>
                <CornerUpLeft className="size-[18px]" />
              </ToolButton>
              {mine && m.text && (
                <ToolButton label="Edit" onClick={() => actions.startEdit(m.id)}>
                  <Pencil className="size-[17px]" />
                </ToolButton>
              )}
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="More"
                    title="More"
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
                  >
                    <MoreHorizontal className="size-[18px]" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {menu.map((item) => (
                    <MenuRow key={item.label} item={item} kind="dropdown" />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {menu.map((item) => (
          <MenuRow key={item.label} item={item} kind="context" />
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function Divider({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "brand" }) {
  return (
    <div
      className={cn(
        "mt-4 flex items-center gap-3 px-4 text-[11px] font-semibold tracking-wider uppercase",
        tone === "brand" ? "text-brand-text" : "text-muted-foreground",
      )}
    >
      <span className={cn("h-px flex-1", tone === "brand" ? "bg-brand/50" : "bg-border")} />
      {children}
      {tone === "muted" && <span className="h-px flex-1 bg-border" />}
    </div>
  );
}

export function MessageList({
  rows,
  messages,
  editingId,
  flashId,
  actions,
}: {
  rows: Row[];
  messages: Message[];
  editingId: string | null;
  flashId: string | null;
  actions: MessageActions;
}) {
  return (
    <div data-messages className="pt-5 pb-4">
      {rows.map((row) =>
        row.kind === "day" ? (
          <Divider key={row.key}>{row.label}</Divider>
        ) : row.kind === "unread" ? (
          <Divider key={row.key} tone="brand">
            New messages
          </Divider>
        ) : (
          <MessageRow
            key={row.key}
            m={row.m}
            head={row.head}
            all={messages}
            editing={editingId === row.m.id}
            flash={flashId === row.m.id}
            last={row.m.id === messages.at(-1)?.id}
            actions={actions}
          />
        ),
      )}
    </div>
  );
}
