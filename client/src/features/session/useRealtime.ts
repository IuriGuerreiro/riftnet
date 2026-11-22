import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  forgetServer,
  onServerMemberUpdated,
  onServerRemoved,
  refreshServerAccess,
} from "../../api/server-access";
import { useAuth } from "../../stores/auth";
import { useCalls } from "../../stores/calls";
import { useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { useFriends } from "../../stores/friends";
import { usePresence } from "../../stores/presence";
import { fromJson, fromProto, nameOf, useProfiles } from "../../stores/profiles";
import { useServerNames } from "../../stores/serverNames";
import { useTyping } from "../../stores/typing";

export function useRealtime() {
  const { ws, user: me, connect, disconnect } = useConnection();
  const queryClient = useQueryClient();
  const userId = useAuth((state) => state.user?.id);
  useEffect(() => {
    if (!ws) return;
    const stopRemoved = onServerRemoved(ws, (serverId) =>
      forgetServer(queryClient, userId, serverId),
    );
    useServerNames.getState().reset();
    const stopMembers = onServerMemberUpdated(ws, queryClient, userId);
    void refreshServerAccess(queryClient, userId).catch(() => {});
    return () => {
      stopRemoved();
      stopMembers();
    };
  }, [ws, queryClient, userId]);

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
}

export function useKnownUsers() {
  const { ws, user: me } = useConnection();
  const conversations = useChat((s) => s.conversations);
  const friendList = useFriends((s) => s.list);

  useEffect(() => {
    useProfiles
      .getState()
      .put([
        ...(me ? [fromProto(me)] : []),
        ...conversations.flatMap((c) => c.members.map(fromProto)),
        ...[...friendList.friends, ...friendList.incoming, ...friendList.outgoing].map((f) =>
          fromJson(f.user),
        ),
      ]);
  }, [me, conversations, friendList]);

  const watchedIds = [
    ...friendList.friends.map((f) => f.user.id),
    ...conversations.flatMap((c) => c.members.map((m) => m.id.toString())),
  ]
    .filter((id) => id !== me?.id.toString())
    .sort()
    .join(",");
  useEffect(() => {
    if (ws && watchedIds) void usePresence.getState().load(ws, [...new Set(watchedIds.split(","))]);
  }, [ws, watchedIds]);
}

export function useNameFor() {
  const profiles = useProfiles((s) => s.byId);
  return (id: bigint | string | undefined) =>
    id === undefined ? "Someone" : nameOf(profiles[id.toString()]);
}
