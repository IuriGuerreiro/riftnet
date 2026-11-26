import {
  AtSign,
  Bell,
  BellOff,
  Hash,
  Phone,
  Pin,
  Search,
  Settings2,
  Upload,
  Users,
  Video,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";

import { Avatar, AvatarStack } from "@/components/Avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmojiText } from "@/features/emoji/EmojiText";
import { type Staged } from "@/features/media/StagedTray";
import { toAttachment } from "@/features/media/toAttachment";
import { openChat } from "@/features/profile/openChat";
import { activityText } from "@/features/shell/activityText";
import { scrollBehavior } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  type Attachment,
  type Conversation,
  conversation,
  CONVERSATIONS,
  type Message,
  messagesFor,
  olderMessages,
  server,
  SERVERS,
  user,
} from "@/mock/data";
import {
  change,
  isOwner,
  openDialog,
  removeConversation,
  toast,
  toggleMuted,
  useWorld,
  world,
} from "@/mock/world";

import { chatReducer, type ChatState, initChat, lastOwnMessage } from "./chatState";
import { Composer } from "./Composer";
import { DeleteDialog } from "./DeleteDialog";
import { getDraft, saveDraft } from "./drafts";
import { mentionsMe } from "./mentions";
import { type MessageActions, MessageList } from "./MessageList";
import { buildRows } from "./rows";
import { Thread } from "./Thread";

const MAX_FILES = 10;
const MAX_SIZE = 100 * 1024 * 1024;

const chats = new Map<string, ChatState>();

const SEARCHABLE = CONVERSATIONS;

function parseSearch(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/);
  const pick = (key: string) =>
    words.filter((w) => w.startsWith(key)).map((w) => w.slice(key.length));
  return {
    from: pick("from:"),
    has: pick("has:"),
    text: words.filter((w) => !/^(from|has):/.test(w)).join(" "),
  };
}

function matches(m: Message, q: ReturnType<typeof parseSearch>) {
  const author = user(m.author);
  return (
    m.text.toLowerCase().includes(q.text) &&
    q.from.every((f) => author.handle.startsWith(f) || author.name.toLowerCase().startsWith(f)) &&
    q.has.every((h) =>
      h === "link"
        ? /https?:/.test(m.text)
        : h === "pin"
          ? m.pinned
          : m.attachments?.some((a) => a.kind === h || (h === "image" && a.kind === "gif")),
    )
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  const at = term ? text.toLowerCase().indexOf(term) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-brand/40 text-foreground">
        {text.slice(at, at + term.length)}
      </mark>
      {text.slice(at + term.length)}
    </>
  );
}

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
  previewId,
  floating,
  onCloseAside,
  onCall,
  onUnread,
  headerLeading,
  className,
}: {
  conversationId: string;
  membersOpen?: boolean;
  onToggleMembers?: () => void;
  lane?: "full" | "center" | "left";
  panelInDm?: boolean;
  aside?: ReactNode;
  previewId?: string | null;
  floating?: ReactNode;
  onCloseAside?: () => void;
  onCall?: (video: boolean) => void;
  onUnread?: (unread: boolean) => void;
  headerLeading?: ReactNode;
  className?: string;
}) {
  const c = conversation(conversationId);
  const [state, dispatch] = useReducer(
    chatReducer,
    c,
    (current) =>
      chats.get(current.id) ??
      initChat({ messages: messagesFor(current), unread: world.empty ? 0 : current.unread }),
  );
  const [staged, setStaged] = useState<Staged[]>(() => getDraft(c.id).staged);
  const [panel, setPanel] = useState<"search" | "mentions" | "pins" | null>(null);
  const [seenPreview, setSeenPreview] = useState(previewId);
  if (previewId !== seenPreview) {
    setSeenPreview(previewId);
    if (previewId) setPanel(null);
  }
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [away, setAway] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  useWorld();
  const [thread, setThread] = useState<string | null>(null);
  const [everywhere, setEverywhere] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const anchor = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const { messages } = state;
  const connection = world.connection;

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
    if (connection !== "online") return;
    const timer = window.setTimeout(() => {
      for (const m of pending)
        dispatch({ type: "delivered", id: m.id, ok: !m.text.startsWith("/fail") });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [messages, connection]);

  const arrived = world.pending[c.id];
  useEffect(() => {
    const incoming = world.pending[c.id];
    if (!incoming?.length) return;
    for (const message of incoming) dispatch({ type: "receive", message });
    change(() => {
      world.pending = Object.fromEntries(
        Object.entries(world.pending).filter(([id]) => id !== c.id),
      );
    });
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160)
      requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
  }, [arrived, c.id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || anchor.current === null) return;
    el.scrollTop += el.scrollHeight - anchor.current;
    anchor.current = null;
  }, [state.older]);

  const loadOlder = () => {
    if (loadingOlder || state.older === 0 || connection !== "online") return;
    setLoadingOlder(true);
    setTimeout(() => {
      anchor.current = scroller.current?.scrollHeight ?? null;
      dispatch({ type: "prepend", messages: olderMessages(c, 2 - state.older) });
      setLoadingOlder(false);
    }, 700);
  };

  const copy = (text: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast("Copied");
      } catch {
        setNotice(`Copy this: ${text}`);
      }
    })();
  };

  const actions: MessageActions = {
    react: (id, emoji) => dispatch({ type: "react", id, emoji }),
    pin: (id) => dispatch({ type: "pin", id }),
    markUnread: (id) => {
      dispatch({ type: "markUnread", id });
      onUnread?.(true);
    },
    forward: (m) => openDialog({ kind: "forward", text: m.text }),
    report: (m) => openDialog({ kind: "report", what: `message from ${user(m.author).name}` }),
    thread: (id) => {
      setPanel(null);
      setThread(id);
    },
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
      document
        .getElementById(`msg-${id}`)
        ?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
      setFlashId(id);
      setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1400);
    },
  };
  const chatServer = c.serverId ? server(c.serverId) : undefined;
  const search = parseSearch(query);
  const pool =
    panel === "search" && everywhere
      ? [...SEARCHABLE, ...SERVERS.flatMap((x) => x.channels.filter((ch) => ch.kind === "text"))]
          .map((x) => x.id)
          .filter((id, i, all) => all.indexOf(id) === i)
          .flatMap((id) => {
            const conv = conversation(id);
            const list = id === c.id ? messages : (chats.get(id)?.messages ?? messagesFor(conv));
            return list.map((m) => ({ m, conv }));
          })
      : messages.map((m) => ({ m, conv: c }));
  const results = pool.filter(({ m }) =>
    m.system
      ? false
      : panel === "pins"
        ? m.pinned
        : panel === "mentions"
          ? mentionsMe(m.text)
          : query.trim() && matches(m, search),
  );
  const channel = chatServer?.channels.find((x) => x.id === c.id);
  const blockedReason =
    c.kind === "dm" && world.blocked.has(c.members[0] ?? "")
      ? "You blocked this person. Unblock them to send messages."
      : channel?.readOnly && chatServer && !isOwner(chatServer)
        ? "Only admins can post here."
        : null;
  const channelNames = (chatServer?.channels ?? [])
    .filter((x) => x.kind === "text")
    .map((x) => x.name);
  const threadRoot = messages.find((m) => m.id === thread);
  const replyTarget = state.replyTo ? messages.find((m) => m.id === state.replyTo) : undefined;

  const typing =
    connection !== "online"
      ? []
      : c.id === "dm-maya"
        ? ["Maya"]
        : c.id === "owls-general"
          ? ["Tom", "Noor"]
          : c.id === "group-trip"
            ? ["Léa", "Tom", "Maya"]
            : [];
  const placeholder = c.kind === "channel" ? `Message #${c.title}` : `Message ${c.title}`;
  const post = (text: string, attachments?: Attachment[]) =>
    dispatch({ type: "send", text, attachments });
  const addFiles = (files: File[]) => {
    const room = MAX_FILES - staged.length;
    if (files.length > room) toast(`You can attach up to ${MAX_FILES} files`);
    void Promise.all(files.slice(0, room).map(toAttachment)).then((atts) => {
      const added = atts.map((att) => ({ id: crypto.randomUUID(), att, progress: 0 }));
      setStaged((s) => [...s, ...added]);
      for (const item of added) upload(item.id, files[added.indexOf(item)]);
    });
  };
  const upload = (id: string, file?: File) => {
    const set = (patch: Partial<Staged>) =>
      setStaged((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (file && file.size > MAX_SIZE) {
      set({ error: "Over 100 MB" });
      return;
    }
    let progress = 0;
    set({ progress, error: undefined });
    const timer = setInterval(() => {
      if (world.connection !== "online") {
        clearInterval(timer);
        set({ error: "Upload failed" });
        return;
      }
      progress += 25;
      set({ progress });
      if (progress >= 100) clearInterval(timer);
    }, 200);
  };
  const laneClass =
    lane === "center" ? "mx-auto w-full max-w-3xl" : lane === "left" ? "w-full max-w-[820px]" : "";

  return (
    <section
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
          e.preventDefault();
          setThread(null);
          setPanel("search");
        }
      }}
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
            <span className="grid size-14 place-items-center rounded-2xl bg-brand/15 text-brand-text">
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
              <HeaderButton label="Start voice call" onClick={() => onCall?.(false)}>
                <Phone className="size-[18px]" />
              </HeaderButton>
              <HeaderButton label="Start video call" onClick={() => onCall?.(true)}>
                <Video className="size-[18px]" />
              </HeaderButton>
            </>
          )}
          {(c.kind !== "dm" || panelInDm) && onToggleMembers && (
            <HeaderButton
              label={c.kind === "dm" ? "Profile" : "Members"}
              active={membersOpen && !panel}
              onClick={() => {
                setPanel(null);
                setThread(null);
                if (!panel || !membersOpen) onToggleMembers();
              }}
            >
              <Users className="size-[18px]" />
            </HeaderButton>
          )}
          <HeaderButton
            label={world.muted.has(c.id) ? "Unmute chat" : "Mute chat"}
            active={world.muted.has(c.id)}
            onClick={() => toggleMuted(c.id)}
          >
            {world.muted.has(c.id) ? (
              <BellOff className="size-[18px]" />
            ) : (
              <Bell className="size-[18px]" />
            )}
          </HeaderButton>
          {c.kind === "group" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Group options"
                  className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Settings2 className="size-[18px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={c.members.length >= 4}
                  onSelect={() => openDialog({ kind: "addMembers", id: c.id })}
                >
                  {c.members.length >= 4 ? "Group is full" : "Add people"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openDialog({ kind: "renameGroup", id: c.id })}>
                  Rename group
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    openDialog({
                      kind: "confirm",
                      title: `Leave ${c.title}?`,
                      body: "Someone has to add you back.",
                      action: "Leave group",
                      run: () => {
                        openChat("dm-maya");
                        removeConversation(c.id);
                      },
                    })
                  }
                >
                  Leave group
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <HeaderButton
            label="Pinned messages"
            active={panel === "pins"}
            onClick={() => {
              setThread(null);
              setPanel(panel === "pins" ? null : "pins");
            }}
          >
            <Pin className="size-[18px]" />
          </HeaderButton>
          <HeaderButton
            label="Mentions"
            active={panel === "mentions"}
            onClick={() => {
              setThread(null);
              setPanel(panel === "mentions" ? null : "mentions");
            }}
          >
            <AtSign className="size-[18px]" />
          </HeaderButton>
          <HeaderButton
            label="Search"
            active={panel === "search"}
            onClick={() => {
              setThread(null);
              setPanel(panel === "search" ? null : "search");
            }}
          >
            <Search className="size-[18px]" />
          </HeaderButton>
        </div>
      </header>
      <div className="@container relative flex min-h-0 flex-1">
        <div className="@container relative flex min-w-0 flex-1 flex-col">
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
          {state.unreadFrom && away && (
            <div className="flex items-center justify-between bg-brand/15 px-4 py-2 text-xs">
              <button
                type="button"
                onClick={() => state.unreadFrom && actions.jumpTo(state.unreadFrom)}
              >
                Jump to unread messages
              </button>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: "markUnread", id: null });
                  onUnread?.(false);
                }}
              >
                Mark as read
              </button>
            </div>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={scroller}
              role="log"
              aria-label={`Messages in ${c.title}`}
              onScroll={(e) => {
                const el = e.currentTarget;
                setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
                if (el.scrollTop < 60) loadOlder();
              }}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <div className={cn("flex min-h-full flex-col justify-end", laneClass)}>
                {loadingOlder && (
                  <div role="status" aria-label="Loading older messages" className="grid gap-4 p-4">
                    {[1, 2, 3].map((n) => (
                      <div key={n} className="flex animate-pulse gap-3">
                        <span className="size-[38px] rounded-full bg-surface-3" />
                        <span className="h-10 flex-1 rounded-lg bg-surface-2" />
                      </div>
                    ))}
                  </div>
                )}
                {state.older === 0 && (
                  <div className="px-4 pt-8 pb-2">
                    <ConversationIcon c={c} size={56} />
                    <h3 className="mt-3 text-xl font-semibold">{c.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      This is the start of your messages here.
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
                    behavior: scrollBehavior(),
                  })
                }
                className={cn(
                  "absolute z-20 rounded-full bg-brand-fill px-4 py-1 text-sm whitespace-nowrap text-white shadow-lg",
                  floating
                    ? "top-3 left-1/2 -translate-x-1/2"
                    : "bottom-3 left-1/2 -translate-x-1/2",
                )}
              >
                Jump to present
              </button>
            )}
          </div>
          {floating}
          <div className={laneClass}>
            {blockedReason ? (
              <p className="mx-4 mb-4 rounded-xl border border-border bg-surface-2 p-3 text-center text-sm text-muted-foreground">
                {blockedReason}
              </p>
            ) : (
              <Composer
                draftKey={c.id}
                members={c.members}
                isChannel={c.kind === "channel"}
                channels={channelNames}
                placeholder={placeholder}
                typing={typing}
                staged={staged}
                onAddFiles={addFiles}
                onRetryStaged={(id) => upload(id)}
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
            )}
          </div>
        </div>
        {threadRoot ? (
          <Thread key={threadRoot.id} root={threadRoot} onClose={() => setThread(null)} />
        ) : panel ? (
          <aside
            aria-label={
              panel === "pins"
                ? "Pinned messages"
                : panel === "mentions"
                  ? "Mentions"
                  : "Search messages"
            }
            className="flex w-72 max-w-full shrink-0 flex-col @max-3xl:absolute @max-3xl:inset-y-0 @max-3xl:right-0 @max-3xl:z-30 @max-3xl:shadow-2xl border-l border-border bg-surface-1"
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
                className="mx-3 mb-3 rounded border border-border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            )}
            {panel === "search" && (
              <div className="px-3 pb-1">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={everywhere}
                    onChange={(e) => setEverywhere(e.target.checked)}
                    className="accent-brand"
                  />
                  Search everywhere
                </label>
                <div className="mt-2 flex flex-wrap gap-1">
                  {["from:maya", "has:image", "has:link", "has:file", "has:pin"].map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setQuery(`${query.trim()} ${f}`.trim())}
                      className="rounded-md bg-surface-3 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-3">
              {results.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">
                  {panel === "search" && !query.trim()
                    ? "Type to search messages."
                    : "No messages found."}
                </p>
              )}
              {panel === "search" && results.length > 0 && (
                <p className="px-1 pb-2 text-xs text-muted-foreground">
                  {results.length} {results.length === 1 ? "result" : "results"}
                </p>
              )}
              {results.map(({ m, conv }) => (
                <button
                  type="button"
                  key={`${conv.id}-${m.id}`}
                  onClick={() => {
                    if (conv.id === c.id) actions.jumpTo(m.id);
                    else openChat(conv.id);
                  }}
                  className="mb-2 block w-full rounded-lg border border-border p-3 text-left hover:bg-accent"
                >
                  <span className="block text-xs font-semibold">
                    {user(m.author).name} · {m.time}
                    {conv.id !== c.id && ` · ${conv.title}`}
                  </span>
                  <span className="mt-1 block line-clamp-3 text-sm text-muted-foreground">
                    <Highlight
                      text={m.text || "Attachment"}
                      term={panel === "search" ? search.text : ""}
                    />
                  </span>
                </button>
              ))}
            </div>
          </aside>
        ) : (
          Boolean(aside) && (
            <div className="flex shrink-0 @max-3xl:absolute @max-3xl:inset-y-0 @max-3xl:right-0 @max-3xl:z-30 @max-3xl:max-w-full @max-3xl:shadow-2xl">
              {aside}
              {onCloseAside && (
                <button
                  type="button"
                  aria-label="Close panel"
                  onClick={onCloseAside}
                  className="absolute top-2 right-2 hidden size-7 place-items-center rounded-md bg-black/50 text-white @max-3xl:grid"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          )
        )}
      </div>
      <DeleteDialog
        message={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && dispatch({ type: "delete", id: deleting.id })}
      />
    </section>
  );
}
