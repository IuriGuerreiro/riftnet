import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { downloadFile, formatSize, previewUrl, uploadFile } from "../api/attachments";
import { useLogout } from "../api/auth";
import { http } from "../api/http";
import type { Friend, User } from "../api/types";
import { CallBar, IncomingCall, RemoteScreen } from "../call/CallBar";
import { Avatar } from "../components/Avatar";
import { ProfilePanel } from "../components/ProfilePanel";
import { StatusDot } from "../components/StatusDot";
import type { Conversation } from "../gen/v1/conversations_pb";
import type { Attachment as AttachmentInfo } from "../gen/v1/messages_pb";
import { useAuth } from "../stores/auth";
import { useCalls } from "../stores/calls";
import { type ChatMessage, isGroup, useChat } from "../stores/chat";
import { useConnection } from "../stores/connection";
import { useFriends } from "../stores/friends";
import { usePresence } from "../stores/presence";
import { fromJson, fromProto, nameOf, useProfiles } from "../stores/profiles";
import { QUICK_EMOJIS, type ReactionChip, reactorsText } from "../stores/reactions";
import { typingText, useTyping } from "../stores/typing";

const dot = { online: "bg-green-500", connecting: "bg-yellow-500", offline: "bg-red-500" };

export function HomePage() {
  const logout = useLogout();
  const navigate = useNavigate();
  const { status, error: connError, ws, user: me, connect, disconnect } = useConnection();
  const chat = useChat();

  useEffect(() => {
    void connect();
    return () => {
      disconnect();
      useTyping.getState().reset();
    };
  }, [connect, disconnect]);

  useEffect(() => {
    if (!ws) return;
    if (me) void useChat.getState().attach(ws, me.id);
    useCalls.getState().attach(ws, me?.id);
    void useFriends.getState().attach(ws);
    if (me) useTyping.getState().attach(ws, me.id);
    usePresence.getState().attach(ws);
    useProfiles.getState().attach(ws);
  }, [ws, me]);

  const friendList = useFriends((s) => s.list);
  const friends = friendList.friends;
  const profiles = useProfiles((s) => s.byId);
  const [editingProfile, setEditingProfile] = useState(false);
  useEffect(() => {
    useProfiles
      .getState()
      .put([
        ...(me ? [fromProto(me)] : []),
        ...chat.conversations.flatMap((c) => c.members.map(fromProto)),
        ...[...friendList.friends, ...friendList.incoming, ...friendList.outgoing].map((f) =>
          fromJson(f.user),
        ),
      ]);
  }, [me, chat.conversations, friendList]);
  const nameFor = (id: bigint | string | undefined) =>
    id === undefined ? "someone" : nameOf(profiles[id.toString()]);
  const watchedIds = [
    ...friends.map((f) => f.user.id),
    ...chat.conversations.flatMap((c) => c.members.map((m) => m.id.toString())),
  ]
    .filter((id) => id !== me?.id.toString())
    .sort()
    .join(",");
  useEffect(() => {
    if (ws && watchedIds) void usePresence.getState().load(ws, [...new Set(watchedIds.split(","))]);
  }, [ws, watchedIds]);

  const selected = chat.conversations.find((c) => c.id === chat.selected);
  const other = (c: Conversation) => c.members.find((m) => m.id !== me?.id) ?? c.members[0];
  const title = (c: Conversation) => (isGroup(c) ? `# ${c.name}` : nameFor(other(c)?.id));

  return (
    <div className="flex h-full w-full max-w-5xl overflow-hidden rounded-xl bg-zinc-900 shadow-lg">
      <RemoteScreen />
      <IncomingCall ws={ws} callerName={(id) => nameFor(id)} />
      {}
      {editingProfile && me && (
        <ProfilePanel myId={me.id.toString()} onClose={() => setEditingProfile(false)} />
      )}
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800">
        <header className="space-y-1 border-b border-zinc-800 p-4">
          <button
            className="flex w-full items-center gap-2 rounded-lg text-left font-bold hover:bg-zinc-800"
            title="Edit profile"
            disabled={!me}
            onClick={() => setEditingProfile(true)}
          >
            <Avatar userId={me?.id} />
            <span className="truncate text-brand">{me ? nameFor(me.id) : "…"}</span>
          </button>
          <p className="flex items-center gap-2 text-xs text-zinc-400">
            <span className={`size-2 rounded-full ${dot[status]}`} />
            {status}
            {connError && <span className="text-red-400">({connError})</span>}
          </p>
        </header>

        <NewDm disabled={!ws} onOpen={(username) => ws && chat.openDm(ws, username)} />
        <NewGroup
          disabled={!ws}
          onCreate={(name, usernames) => ws && chat.createGroup(ws, name, usernames)}
        />
        <FriendsPanel onDm={(username) => ws && chat.openDm(ws, username)} />

        <nav className="flex-1 overflow-y-auto">
          {chat.conversations.map((c) => (
            <button
              key={c.id.toString()}
              onClick={() => ws && chat.select(ws, c.id)}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-zinc-800 ${c.id === chat.selected ? "bg-zinc-800 text-brand" : ""}`}
            >
              {!isGroup(c) && <Avatar userId={other(c)?.id} size="xs" />}
              {!isGroup(c) && <StatusDot userId={other(c)?.id} />}
              <span className="truncate">{title(c)}</span>
            </button>
          ))}
          {chat.conversations.length === 0 && (
            <p className="p-4 text-xs text-zinc-500">No conversations yet.</p>
          )}
        </nav>

        <button
          className="border-t border-zinc-800 p-3 text-sm text-zinc-400 hover:text-zinc-100"
          onClick={() => {
            disconnect();
            logout.mutate(undefined, { onSettled: () => void navigate({ to: "/login" }) });
          }}
        >
          Log out
        </button>
      </aside>

      {}
      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            {isGroup(selected) ? (
              <GroupHeader
                group={selected}
                onAdd={(username) => ws && chat.addMember(ws, username)}
                onRename={(name) => ws && chat.renameGroup(ws, name)}
                onLeave={() => ws && chat.leaveGroup(ws)}
              />
            ) : (
              <header className="flex items-center justify-between border-b border-zinc-800 p-4 font-semibold">
                <span className="flex items-center gap-2">
                  <Avatar userId={other(selected)?.id} />
                  <StatusDot userId={other(selected)?.id} />
                  {title(selected)}
                </span>
                <CallBar ws={ws} conversationId={selected.id} />
              </header>
            )}
            <Messages conversationId={selected.id} myId={me?.id} />
            <TypingIndicator conversation={selected} />
            <Composer
              conversationId={selected.id}
              disabled={!ws}
              onType={() => ws && useTyping.getState().typed(ws, selected.id)}
              onSend={(text, ids) => ws && me && chat.send(ws, me.id, text, ids)}
            />
          </>
        ) : (
          <p className="m-auto text-sm text-zinc-500">
            Pick a conversation, or start a DM or a group.
          </p>
        )}
        {chat.error && <p className="px-4 pb-2 text-xs text-red-400">{chat.error}</p>}
      </section>
    </div>
  );
}

function NewGroup({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  onCreate: (name: string, usernames: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [usernames, setUsernames] = useState("");
  return (
    <form
      className="space-y-2 border-b border-zinc-800 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const list = usernames
          .split(",")
          .map((u) => u.trim())
          .filter(Boolean);
        if (!name.trim() || list.length === 0) return;
        onCreate(name.trim(), list);
        setName("");
        setUsernames("");
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="group name"
        className={field}
      />
      <div className="flex gap-2">
        <input
          value={usernames}
          onChange={(e) => setUsernames(e.target.value)}
          placeholder="ana, bob, carl"
          className={field}
        />
        <button
          disabled={disabled}
          className="rounded-md bg-brand px-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
        >
          Group
        </button>
      </div>
    </form>
  );
}

function GroupHeader({
  group,
  onAdd,
  onRename,
  onLeave,
}: {
  group: Conversation;
  onAdd: (username: string) => void;
  onRename: (name: string) => void;
  onLeave: () => void;
}) {
  const [username, setUsername] = useState("");
  const profiles = useProfiles((s) => s.byId);
  return (
    <header className="space-y-2 border-b border-zinc-800 p-4">
      <div className="flex items-center gap-3">
        <button
          className="font-semibold hover:text-brand"
          title="Rename"
          onClick={() => {
            const name = prompt("New group name", group.name);
            if (name?.trim()) onRename(name.trim());
          }}
        >
          # {group.name}
        </button>
        <span className="text-xs text-zinc-500">{group.members.length}/5</span>
        <button className="ml-auto text-xs text-red-400 hover:text-red-300" onClick={onLeave}>
          Leave
        </button>
      </div>
      <p className="text-xs text-zinc-400">
        {group.members.map((m) => nameOf(profiles[m.id.toString()])).join(", ")}
      </p>
      {group.members.length < 5 && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!username.trim()) return;
            onAdd(username.trim());
            setUsername("");
          }}
        >
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="add username"
            className={field}
          />
          <button className="rounded-md bg-zinc-700 px-2 text-sm hover:bg-zinc-600">Add</button>
        </form>
      )}
    </header>
  );
}

function FriendsPanel({ onDm }: { onDm: (username: string) => void }) {
  const { list, error, sendRequest, accept, deleteRequest, removeFriend } = useFriends();
  const [open, setOpen] = useState(true);
  const [username, setUsername] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const userId = useAuth((s) => s.user?.id);
  const query = username.trim().toLowerCase();
  const validQuery = /^[a-z0-9_.]{1,32}$/.test(query);
  const searchReady = open && !!userId && validQuery && query === debouncedQuery;
  const search = useQuery({
    queryKey: ["users", "search", userId, debouncedQuery],
    enabled: searchReady,
    queryFn: () => http<User[]>(`/users/search?${new URLSearchParams({ q: debouncedQuery })}`),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const addFriend = useMutation({
    mutationFn: ({ target }: { target: string; input: string }) => sendRequest(target),
    onSuccess: (sent, { input }) => {
      if (sent) setUsername((current) => (current === input ? "" : current));
    },
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const profiles = useProfiles((s) => s.byId);
  const name = (f: Friend) => nameOf(profiles[f.user.id] ?? fromJson(f.user));
  const pendingCount = list.incoming.length;

  return (
    <section className="border-b border-zinc-800">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-100"
        onClick={() => setOpen(!open)}
      >
        <span>
          Friends ({list.friends.length})
          {pendingCount > 0 && (
            <span className="ml-2 rounded-full bg-brand px-1.5 text-zinc-950">{pendingCount}</span>
          )}
        </span>
        <span>{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="max-h-72 space-y-2 overflow-y-auto px-3 pb-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (validQuery && !addFriend.isPending) {
                addFriend.mutate({ target: query, input: username });
              }
            }}
          >
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-label="Search by username"
              placeholder="Search by username"
              className={field}
            />
            <button
              disabled={!validQuery || addFriend.isPending}
              className="rounded-md bg-zinc-700 px-2 text-sm hover:bg-zinc-600 disabled:opacity-50"
            >
              Add
            </button>
          </form>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {query && !validQuery && (
            <p className="text-xs text-zinc-400">Use 1–32 letters, numbers, underscores or dots.</p>
          )}
          {validQuery && (!searchReady || search.isPending) && (
            <p role="status" className="text-xs text-zinc-400">
              Searching…
            </p>
          )}
          {searchReady && search.isError && (
            <p role="alert" className="text-xs text-red-400">
              {search.error.message}
            </p>
          )}
          {searchReady && search.isSuccess && search.data.length === 0 && (
            <p role="status" className="text-xs text-zinc-400">
              No matching usernames.
            </p>
          )}
          {searchReady &&
            search.data?.map((user) => {
              const target = user.username;
              if (!target) return null;
              const isFriend = list.friends.some((friend) => friend.user.id === user.id);
              const sent = list.outgoing.some((friend) => friend.user.id === user.id);
              const incoming = list.incoming.some((friend) => friend.user.id === user.id);
              return (
                <div key={user.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{user.display_name ?? target}</p>
                    {user.display_name && (
                      <p className="truncate text-xs text-zinc-400">@{target}</p>
                    )}
                  </div>
                  {isFriend || sent ? (
                    <span className="shrink-0 text-xs text-zinc-400">
                      {isFriend ? "Friend" : "Request sent"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`${incoming ? "Accept request from" : "Add"} @${target}`}
                      disabled={addFriend.isPending}
                      className="shrink-0 text-xs text-brand hover:underline disabled:opacity-50"
                      onClick={() => addFriend.mutate({ target, input: username })}
                    >
                      {incoming ? "Accept" : "Add"}
                    </button>
                  )}
                </div>
              );
            })}

          {list.incoming.map((f) => (
            <FriendRow
              key={f.user.id}
              label={name(f)}
              avatarId={f.user.id}
              hint="wants to be friends"
            >
              <RowButton onClick={() => accept(f.user.id)} className="text-green-400">
                Accept
              </RowButton>
              <RowButton onClick={() => deleteRequest(f.user.id)} className="text-red-400">
                Decline
              </RowButton>
            </FriendRow>
          ))}
          {list.outgoing.map((f) => (
            <FriendRow key={f.user.id} label={name(f)} avatarId={f.user.id} hint="request sent">
              <RowButton onClick={() => deleteRequest(f.user.id)} className="text-zinc-400">
                Cancel
              </RowButton>
            </FriendRow>
          ))}
          {list.friends.map((f) => (
            <FriendRow key={f.user.id} label={name(f)} avatarId={f.user.id} userId={f.user.id}>
              <RowButton
                onClick={() => f.user.username && onDm(f.user.username)}
                className="text-brand"
              >
                DM
              </RowButton>
              <RowButton
                onClick={() => f.user.username && onDm(f.user.username)}
                className="text-brand"
              >
                DM
              </RowButton>
              <RowButton
                onClick={() =>
                  confirm(`Remove ${name(f)} from friends?`) && removeFriend(f.user.id)
                }
                className="text-red-400"
              >
                Remove
              </RowButton>
            </FriendRow>
          ))}
          {list.friends.length + list.incoming.length + list.outgoing.length === 0 && (
            <p className="text-xs text-zinc-500">No friends yet. Add someone by username.</p>
          )}
        </div>
      )}
    </section>
  );
}

function FriendRow({
  label,
  hint,
  userId,
  avatarId,
  children,
}: {
  label: string;
  hint?: string;
  userId?: string;
  avatarId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Avatar userId={avatarId} size="xs" />
      {userId && <StatusDot userId={userId} />}
      <div className="min-w-0 flex-1">
        <p className="truncate">{label}</p>
        {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function RowButton({
  onClick,
  className,
  children,
}: {
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className={`text-xs hover:underline ${className}`}>
      {children}
    </button>
  );
}

const field =
  "min-w-0 flex-1 rounded-md bg-zinc-800 px-2 py-1 text-sm outline-none ring-brand focus:ring-2";

function NewDm({ disabled, onOpen }: { disabled: boolean; onOpen: (username: string) => void }) {
  const [username, setUsername] = useState("");
  return (
    <form
      className="flex gap-2 border-b border-zinc-800 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!username.trim()) return;
        onOpen(username.trim());
        setUsername("");
      }}
    >
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="username"
        className="min-w-0 flex-1 rounded-md bg-zinc-800 px-2 py-1 text-sm outline-none ring-brand focus:ring-2"
      />
      <button
        disabled={disabled}
        className="rounded-md bg-brand px-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
      >
        DM
      </button>
    </form>
  );
}

function Messages({ conversationId, myId }: { conversationId: bigint; myId?: bigint }) {
  const messages = useChat((s) => s.messages[conversationId.toString()]) ?? [];
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView();
  }, [messages.length]);

  return (
    <div className="flex-1 space-y-1 overflow-y-auto p-4">
      {messages.map((m) => (
        <MessageRow key={m.nonce ?? m.id.toString()} m={m} mine={m.authorId === myId} />
      ))}
      <div ref={bottom} />
    </div>
  );
}

function MessageRow({ m, mine }: { m: ChatMessage; mine: boolean }) {
  const ws = useConnection((s) => s.ws);
  const { edit, remove } = useChat();
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
        {canChange && (
          <div className="hidden gap-1 text-xs text-zinc-400 group-hover:flex">
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
          </div>
        )}
        <p
          className={`max-w-[75%] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-sm ${
            mine ? "bg-brand text-zinc-950" : "bg-zinc-800"
          } ${m.pending ? "opacity-50" : ""} ${m.failed ? "ring-2 ring-red-500" : ""}`}
          title={m.pending ? "sending…" : `seq ${m.seq}`}
        >
          {m.text}
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
        </p>
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

function ReactionPicker({ messageId }: { messageId: bigint }) {
  const ws = useConnection((s) => s.ws);
  const toggle = useChat((s) => s.toggleReaction);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!ws) return null;

  return (
    <div ref={ref} className="relative">
      <button
        aria-label="Add reaction"
        title="Add reaction"
        onClick={() => setOpen((o) => !o)}
        className={`${open ? "flex" : "hidden group-hover:flex"} rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100`}
      >
        ☺+
      </button>
      {open && (
        <div className="absolute bottom-full z-10 mb-1 flex gap-0.5 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-lg">
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => {
                setOpen(false);
                void toggle(ws, messageId, e);
              }}
              className="rounded px-1 text-lg hover:bg-zinc-800"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReactionChipButton({
  messageId,
  r,
  disabled,
}: {
  messageId: bigint;
  r: ReactionChip;
  disabled: boolean;
}) {
  const ws = useConnection((s) => s.ws);
  const { toggleReaction, reactors } = useChat();
  const members = useChat((s) => s.conversations.find((c) => c.id === s.selected)?.members ?? []);
  const profiles = useProfiles((s) => s.byId);
  const [who, setWho] = useState<{ count: number; ids: bigint[] } | null>(null);

  async function loadWho() {
    if (!ws || who?.count === r.count) return;
    try {
      setWho({ count: r.count, ids: await reactors(ws, messageId, r.emoji) });
    } catch {
      setWho(null);
    }
  }
  const names = (who?.ids ?? []).map((id) => {
    const member = members.find((u) => u.id === id);
    return member ? nameOf(fromProto(member)) : nameOf(profiles[id.toString()]);
  });

  return (
    <button
      disabled={disabled}
      onMouseEnter={() => void loadWho()}
      onFocus={() => void loadWho()}
      onClick={() => ws && void toggleReaction(ws, messageId, r.emoji)}
      title={names.length ? `${reactorsText(names, r.count)} reacted with ${r.emoji}` : r.emoji}
      aria-pressed={r.me}
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        r.me
          ? "border-brand bg-brand/15 text-zinc-100"
          : "border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:border-zinc-500"
      }`}
    >
      <span className="text-sm">{r.emoji}</span>
      <span>{r.count}</span>
    </button>
  );
}

function TypingIndicator({ conversation }: { conversation: Conversation }) {
  const typing = useTyping((s) => s.typing[conversation.id.toString()]);
  const profiles = useProfiles((s) => s.byId);
  const names = Object.keys(typing ?? {}).map((id) => nameOf(profiles[id]));
  return <p className="h-5 truncate px-4 text-xs italic text-zinc-400">{typingText(names)}</p>;
}

function Attachment({ a, mine }: { a: AttachmentInfo; mine: boolean }) {
  const [now] = useState(() => Date.now());
  const [src, setSrc] = useState(a.previewUrl);
  const [broken, setBroken] = useState(false);
  const [retried, setRetried] = useState(false);
  if (!src || broken || Number(a.expiresAt) <= now) return <AttachmentChip a={a} mine={mine} />;

  // WARN: links last 1h. On failure fetch one fresh link, then fall back to the chip, so no retry loop.
  const onError = async () => {
    if (retried) {
      setBroken(true);
      return;
    }
    setRetried(true);
    try {
      setSrc(await previewUrl(a.id));
    } catch {
      setBroken(true);
    }
  };
  const isVideo = a.contentType.startsWith("video/");
  return (
    <span className="mt-1 block">
      {isVideo ? (
        <video
          src={src}
          controls
          preload="metadata"
          onError={onError}
          className="max-h-80 max-w-full rounded"
        />
      ) : (
        <a href={src} target="_blank" rel="noreferrer noopener">
          <img
            src={src}
            alt={a.filename}
            loading="lazy"
            onError={onError}
            className="max-h-80 max-w-full rounded"
          />
        </a>
      )}
      <AttachmentChip a={a} mine={mine} />
    </span>
  );
}

function AttachmentChip({ a, mine }: { a: AttachmentInfo; mine: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState("");
  const [now] = useState(() => Date.now());
  const expired = Number(a.expiresAt) <= now;
  return (
    <button
      type="button"
      disabled={expired || state === "busy"}
      onClick={async () => {
        setState("busy");
        try {
          await downloadFile(a.id, a.filename, a.blake3);
          setState("idle");
        } catch (e) {
          setError((e as Error).message);
          setState("error");
        }
      }}
      title={expired ? "expired" : error || "download"}
      className={`mt-1 flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs ${
        mine ? "border-zinc-800/40" : "border-zinc-600"
      } ${expired ? "opacity-50 line-through" : "hover:underline"}`}
    >
      <span>📎</span>
      <span className="truncate">{a.filename}</span>
      <span className="ml-auto shrink-0 opacity-70">
        {expired
          ? "expired"
          : state === "busy"
            ? "downloading…"
            : state === "error"
              ? "failed"
              : formatSize(a.size)}
      </span>
    </button>
  );
}

function Composer({
  conversationId,
  disabled,
  onType,
  onSend,
}: {
  conversationId: bigint;
  disabled: boolean;
  onType: () => void;
  onSend: (text: string, attachmentIds: bigint[]) => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const busy = progress !== null;

  async function submit() {
    if (!text.trim() && !files.length) return;
    setError(null);
    const ids: bigint[] = [];
    try {
      for (const [i, f] of files.entries()) {
        setProgress(`uploading ${i + 1}/${files.length} · hashing…`);
        ids.push(
          await uploadFile(conversationId, f, (p) =>
            setProgress(`uploading ${i + 1}/${files.length} · ${Math.round(p * 100)}%`),
          ),
        );
      }
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
      return;
    }
    setProgress(null);
    onSend(text, ids);
    setText("");
    setFiles([]);
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-zinc-800 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {(files.length > 0 || error !== null || busy) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          {files.map((f, i) => (
            <span
              key={`${f.name}:${f.size}:${f.lastModified}`}
              className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1"
            >
              📎 {f.name} · {formatSize(f.size)}
              {!busy && (
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="ml-1 hover:text-red-400"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          {busy && <span>{progress}</span>}
          {error && <span className="text-red-400">{error}</span>}
        </div>
      )}
      <div className="flex gap-2">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 10));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => picker.current?.click()}
          title="Attach files"
          className="rounded-lg bg-zinc-800 px-3 text-lg disabled:opacity-50"
        >
          +
        </button>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) onType();
          }}
          placeholder="Message"
          maxLength={4000}
          className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none ring-brand focus:ring-2"
        />
        <button
          disabled={disabled || busy}
          className="rounded-lg bg-brand px-4 font-semibold text-zinc-950 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </form>
  );
}
