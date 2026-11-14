import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useLogout } from "../api/auth";
import type { Conversation } from "../gen/v1/conversations_pb";
import { useChat } from "../stores/chat";
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
    if (ws) void useChat.getState().attach(ws);
  }, [ws]);

  const selected = chat.conversations.find((c) => c.id === chat.selected);
  const other = (c: Conversation) => c.members.find((m) => m.id !== me?.id) ?? c.members[0];

  return (
    <div className="flex h-full w-full max-w-5xl overflow-hidden rounded-xl bg-zinc-900 shadow-lg">
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

        <nav className="flex-1 overflow-y-auto">
          {chat.conversations.map((c) => (
            <button
              key={c.id.toString()}
              onClick={() => ws && chat.select(ws, c.id)}
              className={`block w-full px-4 py-2 text-left text-sm hover:bg-zinc-800 ${c.id === chat.selected ? "bg-zinc-800 text-brand" : ""}`}
            >
              @{other(c)?.username}
            </button>
          ))}
          {chat.conversations.length === 0 && <p className="p-4 text-xs text-zinc-500">No DMs yet.</p>}
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
            <header className="border-b border-zinc-800 p-4 font-semibold">@{other(selected)?.username}</header>
            <Messages conversationId={selected.id} myId={me?.id} />
            <Composer disabled={!ws} onSend={(text) => ws && me && chat.send(ws, me.id, text)} />
          </>
        ) : (
          <p className="m-auto text-sm text-zinc-500">Pick a DM, or start one with a username.</p>
        )}
        {chat.error && <p className="px-4 pb-2 text-xs text-red-400">{chat.error}</p>}
      </section>
    </div>
  );
}

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
      <button disabled={disabled} className="rounded-md bg-brand px-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">
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
