import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Hash, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { channelHistory, onChannelMessage, sendChannelMessage } from "../../api/channel-messages";
import { isServerUnavailable } from "../../api/server-access";
import { Avatar } from "../../components/Avatar";
import { Markdown } from "../../components/Markdown";
import { Button, ErrorText, IconButton } from "../../components/ui";
import { cn } from "../../components/ui/cn";
import type { ChannelMessage } from "../../gen/v1/messages_pb";
import { readableNameColor } from "../../lib/color";
import { formatClock, formatDay, formatStamp } from "../../lib/time";
import { useAuth } from "../../stores/auth";
import { useConnection } from "../../stores/connection";
import { useProfile } from "../../stores/profiles";
import { useAuthorName } from "../../stores/serverNames";
import { groupMessages } from "../chat/groupMessages";
import { ProfileTrigger } from "../profile/ProfileTrigger";

export function ChannelChat({
  channelId: id,
  serverId,
  name,
  onUnavailable,
}: {
  channelId: string;
  serverId: string;
  name: string;
  onUnavailable: () => void;
}) {
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
    queryKey: ["channel-history", userId, serverId, id],
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

  const unavailable = isServerUnavailable(history.error) || isServerUnavailable(send.error);
  useEffect(() => {
    if (unavailable) onUnavailable();
  }, [unavailable, onUnavailable]);

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
  const rows = groupMessages(ordered);
  const submit = () => {
    if (ws && !send.isPending && draft.trim()) send.mutate(draft);
  };

  if (unavailable)
    return (
      <p className="m-auto p-4 text-fg-muted" role="status">
        This server is no longer available.
      </p>
    );

  return (
    <>
      <div aria-label="Channel messages" className="min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="flex min-h-full flex-col justify-end">
          {!ws && <p className="px-4 pt-4 text-sm text-fg-subtle">Connecting…</p>}
          {ws && history.isPending && (
            <p className="px-4 pt-4 text-sm text-fg-subtle">Loading messages…</p>
          )}
          {history.isError && (
            <div className="space-y-2 px-4 pt-4">
              <ErrorText error={history.error} />
              <Button variant="ghost" onClick={() => void refetch()} disabled={!ws}>
                Retry
              </Button>
            </div>
          )}
          {!history.isError && (
            <>
              {history.hasNextPage ? (
                <div className="px-4 pt-4">
                  <Button
                    variant="ghost"
                    disabled={!ws || history.isFetching}
                    onClick={() => void history.fetchNextPage()}
                  >
                    Load older messages
                  </Button>
                </div>
              ) : (
                history.isSuccess && (
                  <div className="px-4 pb-2 pt-8">
                    <span className="mb-3 flex size-16 items-center justify-center rounded-full bg-surface-4 text-fg">
                      <Hash size={36} />
                    </span>
                    <h2 className="text-3xl font-bold text-fg">Welcome to #{name}!</h2>
                    <p className="mt-1 text-fg-muted">This is the start of the #{name} channel.</p>
                  </div>
                )
              )}
              {rows.map(({ message, time, header, dayDivider }) => (
                <div key={message.id.toString()}>
                  {dayDivider && (
                    <div role="separator" className="mx-4 mb-1 mt-6 flex items-center gap-2">
                      <span className="h-px flex-1 bg-line" />
                      <span className="text-xs font-semibold text-fg-subtle">
                        {formatDay(time)}
                      </span>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "group flex gap-4 px-4 py-0.5 hover:bg-surface-1/40",
                      header && "mt-4",
                    )}
                  >
                    <div className="w-10 shrink-0">
                      {header ? (
                        <span className="mt-0.5 block">
                          <AuthorAvatar serverId={serverId} message={message} />
                        </span>
                      ) : (
                        <time
                          dateTime={time.toISOString()}
                          title={formatStamp(time)}
                          className="block pt-1 text-right text-[11px] text-fg-subtle opacity-0 group-hover:opacity-100"
                        >
                          {formatClock(time)}
                        </time>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      {header && (
                        <p className="flex items-baseline gap-2">
                          <AuthorName
                            serverId={serverId}
                            message={message}
                            mine={message.authorId.toString() === userId}
                          />
                          <time dateTime={time.toISOString()} className="text-xs text-fg-subtle">
                            {formatStamp(time)}
                          </time>
                        </p>
                      )}
                      <div className="break-words text-[15px] leading-relaxed text-fg-muted">
                        <Markdown text={message.text} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottom} />
            </>
          )}
        </div>
      </div>
      <form
        className="shrink-0 px-4 pb-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {send.error && (
          <div className="rounded-t-panel bg-surface-3 px-4 pt-3 text-xs">
            <ErrorText error={send.error} />
          </div>
        )}
        <div
          className={cn(
            "flex items-end gap-1 bg-surface-3 pl-4 pr-2",
            send.error ? "rounded-b-panel" : "rounded-panel",
          )}
        >
          <textarea
            rows={1}
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
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            className="max-h-60 min-w-0 flex-1 resize-none bg-transparent py-3 text-[15px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
          />
          <IconButton
            type="submit"
            label="Send message"
            icon={<SendHorizontal size={20} />}
            disabled={!ws || send.isPending || !draft.trim() || history.isError}
            className="mb-1.5 hover:text-brand"
          />
        </div>
      </form>
    </>
  );
}

function newNonce() {
  return crypto.getRandomValues(new Uint32Array(4)).join("-");
}

function AuthorAvatar({ serverId, message }: { serverId: string; message: ChannelMessage }) {
  const name = useAuthorName(serverId, message);
  return (
    <ProfileTrigger userId={message.authorId} label={name} nickname={name} className="rounded-full">
      <Avatar userId={message.authorId} size="md" />
    </ProfileTrigger>
  );
}

function AuthorName({
  serverId,
  message,
  mine,
}: {
  serverId: string;
  message: ChannelMessage;
  mine: boolean;
}) {
  const name = useAuthorName(serverId, message);
  const profile = useProfile(message.authorId);
  return (
    <ProfileTrigger
      userId={message.authorId}
      nickname={name}
      className={cn("font-medium hover:underline", mine ? "text-brand" : "text-fg")}
      style={{ color: readableNameColor(profile?.nameColor) }}
    >
      {name}
    </ProfileTrigger>
  );
}
