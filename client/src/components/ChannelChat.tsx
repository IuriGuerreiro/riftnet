import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { channelHistory, onChannelMessage, sendChannelMessage } from "../api/channel-messages";
import type { ChannelMessage } from "../gen/v1/messages_pb";
import { useAuth } from "../stores/auth";
import { useConnection } from "../stores/connection";
import { MessageBubble } from "./MessageBubble";
import { ErrorText, Input } from "./ui";

export function ChannelChat({ channelId: id, name }: { channelId: string; name: string }) {
  const channelId = BigInt(id);
  const userId = useAuth((state) => state.user?.id);
  const ws = useConnection((state) => state.ws);
  const [live, setLive] = useState(() => ({
    connection: ws,
    messages: new Map<bigint, ChannelMessage>(),
  }));
  const receive = (message: ChannelMessage) =>
    setLive((current) => ({
      connection: ws,
      messages: new Map(current.connection === ws ? current.messages : []).set(message.id, message),
    }));
  const [draft, setDraft] = useState("");
  const [nonce, setNonce] = useState(newNonce);
  const bottom = useRef<HTMLDivElement>(null);
  const history = useInfiniteQuery({
    queryKey: ["channel-history", userId, id],
    enabled: ws !== null,
    initialPageParam: 0n,
    queryFn: ({ pageParam }) => {
      if (!ws) throw new Error("Chat is offline");
      return channelHistory(ws, channelId, pageParam);
    },
    getNextPageParam: (page) => (page.nextBeforeId === 0n ? undefined : page.nextBeforeId),
    retry: false,
  });
  const { refetch } = history;
  useEffect(() => {
    if (!ws) return;
    const unsubscribe = onChannelMessage(ws, channelId, (message) =>
      setLive((current) => ({
        connection: ws,
        messages: new Map(current.connection === ws ? current.messages : []).set(
          message.id,
          message,
        ),
      })),
    );
    void refetch({ cancelRefetch: false });
    return unsubscribe;
  }, [ws, channelId, refetch]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      if (!ws) throw new Error("Chat is offline");
      return sendChannelMessage(ws, channelId, text, nonce);
    },
    onSuccess: (message) => {
      receive(message);
      setDraft("");
      setNonce(newNonce());
    },
  });

  const messages = new Map(live.connection === ws ? live.messages : []);
  for (const page of history.data?.pages ?? []) {
    for (const message of page.messages) messages.set(message.id, message);
  }
  const ordered = [...messages.values()].sort((a, b) => (a.id > b.id ? -1 : 1));
  const newest = ordered[0]?.id;
  ordered.reverse();
  useEffect(() => {
    if (newest !== undefined) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [newest]);

  return (
    <>
      <div aria-label="Channel messages" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {!ws && <p className="text-sm text-zinc-400">Connecting to chat…</p>}
        {ws && history.isPending && <p className="text-sm text-zinc-400">Loading messages…</p>}
        {history.isError && (
          <div className="space-y-1">
            <ErrorText error={history.error} />
            <button className="text-sm text-brand" onClick={() => void refetch()} disabled={!ws}>
              Retry
            </button>
          </div>
        )}
        {!history.isError && (
          <>
            {history.hasNextPage && (
              <button
                className="text-sm text-brand"
                disabled={!ws || history.isFetching}
                onClick={() => void history.fetchNextPage()}
              >
                Load older messages
              </button>
            )}
            {history.isSuccess && ordered.length === 0 && (
              <p className="text-sm text-zinc-400">No messages in #{name} yet.</p>
            )}
            {ordered.map((message) => {
              const mine = message.authorId.toString() === userId;
              return (
                <div
                  key={message.id.toString()}
                  className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}
                >
                  <span className="text-xs text-zinc-400">{message.authorName}</span>
                  <MessageBubble mine={mine}>{message.text}</MessageBubble>
                </div>
              );
            })}
            <div ref={bottom} />
          </>
        )}
      </div>
      <form
        className="space-y-2 border-t border-zinc-800 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ws && !send.isPending && draft.trim()) send.mutate(draft);
        }}
      >
        <ErrorText error={send.error} />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Input
            aria-label={`Message #${name}`}
            placeholder={`Message #${name}`}
            value={draft}
            maxLength={4000}
            disabled={send.isPending}
            onChange={(event) => {
              setDraft(event.target.value);
              setNonce(newNonce());
              if (send.isError) send.reset();
            }}
          />
          <button
            className="rounded-lg bg-brand px-3 text-sm font-semibold text-zinc-950 disabled:opacity-50"
            disabled={!ws || send.isPending || !draft.trim() || history.isError}
          >
            Send
          </button>
        </div>
      </form>
    </>
  );
}

function newNonce() {
  return crypto.getRandomValues(new Uint32Array(4)).join("-");
}
