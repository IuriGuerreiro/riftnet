import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useLogout } from "../api/auth";
import { ConversationKind, type Conversation } from "../gen/v1/conversations_pb";
import type { Friend } from "../api/types";
import { CallBar, IncomingCall } from "../call/CallBar";
import { useCalls } from "../stores/calls";
import { UserSearchInput } from "../components/user-search";
import { useChat } from "../stores/chat";
import { useFriends } from "../stores/friends";
import { useConnection } from "../stores/connection";

const dot = { online: "bg-green-500", connecting: "bg-yellow-500", offline: "bg-red-500" };

// Test chat screen: DM list on the left, the open chat on the right.
// Plain on purpose; José's designs replace it.
export function HomePage() {
  const logout = useLogout();
  const navigate = useNavigate();
  const { status, error: connError, ws, user: me, connect, disconnect } = useConnection();
  const chat = useChat();

  // Keep the socket open while this page is shown.
  useEffect(() => {
    void connect();
    return disconnect;
  }, [connect, disconnect]);

  // Every (re)connect: listen for pushes, reload the list, sync what we missed.
  useEffect(() => {
    if (!ws) return;
    if (me) void useChat.getState().attach(ws, me.id);
    useCalls.getState().attach(ws, me?.id); // after chat: it chains onto chat's push handler
    void useFriends.getState().attach(ws);
  }, [ws, me]);

  const selected = chat.conversations.find((c) => c.id === chat.selected);
  const other = (c: Conversation) => c.members.find((m) => m.id !== me?.id) ?? c.members[0];
  const isGroup = (c: Conversation) => c.kind === ConversationKind.GROUP;
  // Groups show their name, DMs the other person.
  const title = (c: Conversation) => (isGroup(c) ? `# ${c.name}` : `@${other(c)?.username}`);

  return (
    <div className="flex h-full w-full max-w-5xl overflow-hidden rounded-xl bg-zinc-900 shadow-lg">
      <IncomingCall
        ws={ws}
        callerName={(id) =>
          chat.conversations.flatMap((c) => c.members).find((m) => m.id === id)?.username ?? "someone"
        }
      />
      {/* --- sidebar --- */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800">
        <header className="space-y-1 border-b border-zinc-800 p-4">
          <p className="font-bold">
            <span className="text-brand">{me?.username ?? "…"}</span>
          </p>
          <p className="flex items-center gap-2 text-xs text-zinc-400">
            <span className={`size-2 rounded-full ${dot[status]}`} />
            {status}
            {connError && <span className="text-red-400">({connError})</span>}
          </p>
        </header>

        <NewDm disabled={!ws} onOpen={(username) => ws && chat.openDm(ws, username)} />
        <NewGroup disabled={!ws} onCreate={(name, usernames) => ws && chat.createGroup(ws, name, usernames)} />
        <FriendsPanel onDm={(username) => ws && chat.openDm(ws, username)} />

        <nav className="flex-1 overflow-y-auto">
          {chat.conversations.map((c) => (
            <button
              key={c.id.toString()}
              onClick={() => ws && chat.select(ws, c.id)}
              className={`block w-full px-4 py-2 text-left text-sm hover:bg-zinc-800 ${c.id === chat.selected ? "bg-zinc-800 text-brand" : ""}`}
            >
              {title(c)}
            </button>
          ))}
          {chat.conversations.length === 0 && <p className="p-4 text-xs text-zinc-500">No conversations yet.</p>}
        </nav>

        <button
          className="border-t border-zinc-800 p-3 text-sm text-zinc-400 hover:text-zinc-100"
          onClick={() => {
            disconnect();
            logout.mutate(undefined, { onSettled: () => navigate({ to: "/login" }) });
          }}
        >
          Log out
        </button>
      </aside>

      {/* --- chat --- */}
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
                {title(selected)}
                <CallBar ws={ws} conversationId={selected.id} />
              </header>
            )}
            <Messages conversationId={selected.id} myId={me?.id} />
            <Composer disabled={!ws} onSend={(text) => ws && me && chat.send(ws, me.id, text)} />
          </>
        ) : (
          <p className="m-auto text-sm text-zinc-500">Pick a conversation, or start a DM or a group.</p>
        )}
        {chat.error && <p className="px-4 pb-2 text-xs text-red-400">{chat.error}</p>}
      </section>
    </div>
  );
}

// Group name + 2-4 usernames, comma separated (3-5 people with you).
function NewGroup({ disabled, onCreate }: { disabled: boolean; onCreate: (name: string, usernames: string[]) => void }) {
  const [name, setName] = useState("");
  const [usernames, setUsernames] = useState("");
  return (
    <form
      className="space-y-2 border-b border-zinc-800 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const list = usernames.split(",").map((u) => u.trim()).filter(Boolean);
        if (!name.trim() || list.length === 0) return;
        onCreate(name.trim(), list);
        setName("");
        setUsernames("");
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="group name" className={field} />
      <div className="flex gap-2">
        <input value={usernames} onChange={(e) => setUsernames(e.target.value)} placeholder="ana, bob, carl" className={field} />
        <button disabled={disabled} className="rounded-md bg-brand px-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">
          Group
        </button>
      </div>
    </form>
  );
}

// Group chat header: name (click to rename), members, add someone, leave.
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
      <p className="text-xs text-zinc-400">{group.members.map((m) => `@${m.username}`).join(", ")}</p>
      {group.members.length < 5 && (
        <UserSearchInput placeholder="add username" buttonLabel="Add" onSubmit={onAdd} />
      )}
    </header>
  );
}

// Friends: add by username, answer requests, DM or remove friends.
function FriendsPanel({ onDm }: { onDm: (username: string) => void }) {
  const { list, error, sendRequest, accept, deleteRequest, removeFriend } = useFriends();
  const [open, setOpen] = useState(true);
  const name = (f: Friend) => `@${f.user.username ?? f.user.id}`;
  const pendingCount = list.incoming.length;

  return (
    <section className="border-b border-zinc-800">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-100"
        onClick={() => setOpen(!open)}
      >
        <span>
          Friends ({list.friends.length})
          {pendingCount > 0 && <span className="ml-2 rounded-full bg-brand px-1.5 text-zinc-950">{pendingCount}</span>}
        </span>
        <span>{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="max-h-72 space-y-2 overflow-y-auto px-3 pb-3">
          <UserSearchInput placeholder="add friend" buttonLabel="Add" onSubmit={sendRequest} />
          {error && <p className="text-xs text-red-400">{error}</p>}

          {list.incoming.map((f) => (
            <FriendRow key={f.user.id} label={name(f)} hint="wants to be friends">
              <RowButton onClick={() => accept(f.user.id)} className="text-green-400">Accept</RowButton>
              <RowButton onClick={() => deleteRequest(f.user.id)} className="text-red-400">Decline</RowButton>
            </FriendRow>
          ))}
          {list.outgoing.map((f) => (
            <FriendRow key={f.user.id} label={name(f)} hint="request sent">
              <RowButton onClick={() => deleteRequest(f.user.id)} className="text-zinc-400">Cancel</RowButton>
            </FriendRow>
          ))}
          {list.friends.map((f) => (
            <FriendRow key={f.user.id} label={name(f)}>
              <RowButton onClick={() => f.user.username && onDm(f.user.username)} className="text-brand">DM</RowButton>
              <RowButton
                onClick={() => confirm(`Remove ${name(f)} from friends?`) && removeFriend(f.user.id)}
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

function FriendRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate">{label}</p>
        {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function RowButton({ onClick, className, children }: { onClick: () => void; className: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`text-xs hover:underline ${className}`}>
      {children}
    </button>
  );
}

const field = "min-w-0 flex-1 rounded-md bg-zinc-800 px-2 py-1 text-sm outline-none ring-brand focus:ring-2";

function NewDm({ disabled, onOpen }: { disabled: boolean; onOpen: (username: string) => void }) {
  return (
    <div className="border-b border-zinc-800 p-3">
      <UserSearchInput placeholder="username" buttonLabel="DM" disabled={disabled} onSubmit={onOpen} />
    </div>
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
      {messages.map((m) => {
        const mine = m.authorId === myId;
        return (
          <div key={m.nonce ?? m.id.toString()} className={`flex ${mine ? "justify-end" : ""}`}>
            <p
              className={`max-w-[75%] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-sm ${
                mine ? "bg-brand text-zinc-950" : "bg-zinc-800"
              } ${m.pending ? "opacity-50" : ""} ${m.failed ? "ring-2 ring-red-500" : ""}`}
              title={m.pending ? "sending…" : `seq ${m.seq}`}
            >
              {m.text}
            </p>
          </div>
        );
      })}
      <div ref={bottom} />
    </div>
  );
}

function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex gap-2 border-t border-zinc-800 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSend(text);
        setText("");
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Message"
        maxLength={4000}
        className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none ring-brand focus:ring-2"
      />
      <button disabled={disabled} className="rounded-lg bg-brand px-4 font-semibold text-zinc-950 disabled:opacity-50">
        Send
      </button>
    </form>
  );
}
