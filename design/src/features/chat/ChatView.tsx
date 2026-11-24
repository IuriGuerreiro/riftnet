import { AtSign, Hash, Phone, Pin, Search, Upload, Users, Video, X } from "lucide-react";
import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";

import { Avatar, AvatarStack } from "@/components/Avatar";
import { EmojiText } from "@/features/emoji/EmojiText";
import { type Staged } from "@/features/media/StagedTray";
import { toAttachment } from "@/features/media/toAttachment";
import { activityText } from "@/features/shell/activityText";
import { cn } from "@/lib/utils";
import {
  type Attachment,
  type Conversation,
  conversation,
  ME,
  type Message,
  messagesFor,
  server,
  user,
} from "@/mock/data";

import { chatReducer, type ChatState, initChat, lastOwnMessage } from "./chatState";
import { Composer } from "./Composer";
import { DeleteDialog } from "./DeleteDialog";
import { getDraft, saveDraft } from "./drafts";
import { type MessageActions, MessageList } from "./MessageList";
import { buildRows } from "./rows";

const chats = new Map<string, ChatState>();

export function ConversationIcon({ c, size = 24 }: { c: Conversation; size?: number }) {
  if (c.kind === "channel")
    return (
      <Hash className="text-muted-foreground" style={{ width: size * 0.8, height: size * 0.8 }} />
    );
  if (c.kind === "group")
    return <AvatarStack ids={c.members.slice(0, 2)} size={size * 0.8} max={2} />;
  return <Avatar id={c.members[0] ?? ""} size={size} status />;
}

function chatSubtitle(c: Conversation) {
  if (c.kind === "channel") return c.topic ?? server(c.serverId ?? "")?.name;
  if (c.kind === "group") return `${c.members.length + 1} members`;
  const u = user(c.members[0] ?? "");
  if (u.activity) return activityText(u.activity);
  return u.status === "offline" ? "Offline" : `@${u.handle}`;
}

function HeaderButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center rounded-md transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ChatView({
  conversationId,
  membersOpen,
  onToggleMembers,
  lane = "full",
  panelInDm = false,
  aside,
  headerLeading,
  className,
}: {
  conversationId: string;
  membersOpen?: boolean;
  onToggleMembers?: () => void;
  lane?: "full" | "center" | "left";
  panelInDm?: boolean;
  aside?: ReactNode;
  headerLeading?: ReactNode;
  className?: string;
}) {
  const c = conversation(conversationId);
  const [state, dispatch] = useReducer(
    chatReducer,
    c,
    (current) =>
      chats.get(current.id) ?? initChat({ messages: messagesFor(current), unread: current.unread }),
  );
  const [staged, setStaged] = useState<Staged[]>(() => getDraft(c.id).staged);
  const [panel, setPanel] = useState<"search" | "mentions" | "pins" | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [away, setAway] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const { messages } = state;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [state.sent]);

  useEffect(() => {
    chats.set(c.id, state);
  }, [c.id, state]);

  useEffect(() => {
    saveDraft(c.id, { staged });
  }, [c.id, staged]);

  useEffect(() => {
    const pending = messages.filter((m) => m.status === "sending");
    if (!pending.length) return;
    const timer = window.setTimeout(() => {
      for (const m of pending) dispatch({ type: "delivered", id: m.id, ok: true });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [messages]);

  const copy = (text: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        setNotice("Copied to clipboard");
      } catch {
        window.prompt("Copy this text", text);
      }
    })();
  };

  const actions: MessageActions = {
    react: (id, emoji) => dispatch({ type: "react", id, emoji }),
    pin: (id) => dispatch({ type: "pin", id }),
    markUnread: (id) => dispatch({ type: "markUnread", id }),
    retry: (id) => dispatch({ type: "retry", id }),
    copyText: (m) => copy(m.text),
    copyLink: (id) => {
      const link = new URL(window.location.href);
      link.hash = `msg-${id}`;
      copy(link.href);
    },
    reply: (id) => dispatch({ type: "reply", id }),
    startEdit: (id) => dispatch({ type: "startEdit", id }),
    saveEdit: (id, text) => dispatch({ type: "edit", id, text }),
    cancelEdit: () => dispatch({ type: "startEdit", id: null }),
    remove: (id, skip) => {
      if (skip) dispatch({ type: "delete", id });
      else setDeleting(messages.find((m) => m.id === id) ?? null);
    },
    jumpTo: (id) => {
      document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(id);
      setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1400);
    },
  };
  const results = messages.filter((m) =>
    panel === "pins"
      ? m.pinned
      : panel === "mentions"
        ? new RegExp(
            `(?<![\\w@.])@(?:${user(ME).handle.replaceAll(".", "\\.")}|everyone|here)(?![\\w.])`,
            "i",
          ).test(m.text)
        : query.trim() && m.text.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const replyTarget = state.replyTo ? messages.find((m) => m.id === state.replyTo) : undefined;

  const typing = c.id === "dm-maya" ? "Maya" : c.id === "owls-general" ? "Tom" : undefined;
  const placeholder = c.kind === "channel" ? `Message #${c.title}` : `Message ${c.title}`;
  const post = (text: string, attachments?: Attachment[]) =>
    dispatch({ type: "send", text, attachments });
  const addFiles = (files: File[]) => {
    void Promise.all(files.map(toAttachment)).then((atts) =>
      setStaged((s) => [...s, ...atts.map((att, i) => ({ id: `${Date.now()}-${i}`, att }))]),
    );
  };
  const laneClass =
    lane === "center" ? "mx-auto w-full max-w-3xl" : lane === "left" ? "w-full max-w-[820px]" : "";

  return (
    <section
      className={cn("relative flex min-w-0 flex-1 flex-col bg-background", className)}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) addFiles(files);
      }}
    >
      {dragging && (
        <div className="animate-in fade-in pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-brand bg-background/85 backdrop-blur-sm duration-150">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-brand/15 text-brand">
              <Upload className="size-7" />
            </span>
            <p className="text-lg font-semibold">Drop to upload</p>
            <p className="text-sm text-muted-foreground">
              Images, videos, GIFs and files go to <EmojiText text={c.title} size={14} />
            </p>
          </div>
        </div>
      )}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        {headerLeading}
        <ConversationIcon c={c} size={28} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] leading-tight font-semibold">
            <EmojiText text={c.title} size={16} />
          </h2>
          <p className="truncate text-xs text-muted-foreground">{chatSubtitle(c)}</p>
        </div>
        <div className="flex items-center gap-0.5">
          {c.kind !== "channel" && (
            <>
              <HeaderButton label="Start voice call">
                <Phone className="size-[18px]" />
              </HeaderButton>
              <HeaderButton label="Start video call">
                <Video className="size-[18px]" />
              </HeaderButton>
            </>
          )}
          {(c.kind !== "dm" || panelInDm) && onToggleMembers && (
            <HeaderButton
              label={c.kind === "dm" ? "Profile" : "Members"}
              active={membersOpen}
              onClick={onToggleMembers}
            >
              <Users className="size-[18px]" />
            </HeaderButton>
          )}
          <HeaderButton
            label="Pinned messages"
            active={panel === "pins"}
            onClick={() => setPanel(panel === "pins" ? null : "pins")}
          >
            <Pin className="size-[18px]" />
          </HeaderButton>
          <HeaderButton
            label="Mentions"
            active={panel === "mentions"}
            onClick={() => setPanel(panel === "mentions" ? null : "mentions")}
          >
            <AtSign className="size-[18px]" />
          </HeaderButton>
          <HeaderButton
            label="Search"
            active={panel === "search"}
            onClick={() => setPanel(panel === "search" ? null : "search")}
          >
            <Search className="size-[18px]" />
          </HeaderButton>
        </div>
      </header>
      {notice && (
        <div
          role="status"
          className="flex items-center justify-between bg-surface-2 px-4 py-2 text-xs"
        >
          {notice}
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}>
            <X className="size-4" />
          </button>
        </div>
      )}
      {state.unreadFrom && (
        <div className="flex items-center justify-between bg-brand/15 px-4 py-2 text-xs">
          <button
            type="button"
            onClick={() => state.unreadFrom && actions.jumpTo(state.unreadFrom)}
          >
            Jump to unread messages
          </button>
          <button type="button" onClick={() => dispatch({ type: "markUnread", id: null })}>
            Mark as read
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
            }}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div className={cn("flex min-h-full flex-col justify-end", laneClass)}>
              {messages.length === 0 && (
                <div className="p-8">
                  <h3 className="text-lg font-semibold">Start the conversation</h3>
                  <p className="text-sm text-muted-foreground">
                    Send the first message to {c.title}.
                  </p>
                </div>
              )}
              <MessageList
                messages={messages}
                rows={buildRows(messages, state.unreadFrom)}
                editingId={state.editing}
                flashId={flashId}
                actions={actions}
              />
            </div>
          </div>
          {away && (
            <button
              type="button"
              onClick={() =>
                scroller.current?.scrollTo({
                  top: scroller.current.scrollHeight,
                  behavior: "smooth",
                })
              }
              className="mx-auto rounded-full bg-brand px-4 py-1 text-sm text-white"
            >
              Jump to present
            </button>
          )}
          <div className={laneClass}>
            <Composer
              draftKey={c.id}
              members={c.members}
              isChannel={c.kind === "channel"}
              placeholder={placeholder}
              typing={typing}
              staged={staged}
              onAddFiles={addFiles}
              onRemoveStaged={(id) => setStaged((s) => s.filter((x) => x.id !== id))}
              onSendGif={(g) => post("", [g])}
              replyTo={replyTarget}
              onCancelReply={() => dispatch({ type: "reply", id: null })}
              onEditLast={() => {
                const last = lastOwnMessage(state);
                if (last) dispatch({ type: "startEdit", id: last.id });
              }}
              onSend={(text) => {
                post(text, staged.length ? staged.map((x) => x.att) : undefined);
                setStaged([]);
              }}
            />
          </div>
        </div>
        {panel && (
          <aside
            aria-label={
              panel === "pins"
                ? "Pinned messages"
                : panel === "mentions"
                  ? "Mentions"
                  : "Search messages"
            }
            className="flex w-72 shrink-0 flex-col border-l border-border bg-surface-1"
          >
            <div className="flex items-center justify-between p-4">
              <h3 className="font-semibold">
                {panel === "pins"
                  ? "Pinned messages"
                  : panel === "mentions"
                    ? "Mentions"
                    : "Search messages"}
              </h3>
              <button type="button" aria-label="Close panel" onClick={() => setPanel(null)}>
                <X className="size-4" />
              </button>
            </div>
            {panel === "search" && (
              <input
                autoFocus
                aria-label="Search this conversation"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search this conversation"
                className="mx-3 mb-3 rounded border border-border bg-background p-2 text-sm"
              />
            )}
            <div className="flex-1 overflow-y-auto p-3">
              {results.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">
                  {panel === "search" && !query.trim()
                    ? "Type to search messages."
                    : "No messages found."}
                </p>
              )}
              {results.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => actions.jumpTo(m.id)}
                  className="mb-2 block w-full rounded-lg border border-border p-3 text-left hover:bg-accent"
                >
                  <span className="block text-xs font-semibold">
                    {user(m.author).name} · {m.time}
                  </span>
                  <span className="mt-1 block line-clamp-3 text-sm text-muted-foreground">
                    {m.text || "Attachment"}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}
        {aside}
      </div>
      <DeleteDialog
        message={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && dispatch({ type: "delete", id: deleting.id })}
      />
    </section>
  );
}
