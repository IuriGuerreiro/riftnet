import { create } from "zustand";

import { http } from "../api/http";
import type { Friend, FriendsList, FriendState as JsonFriendState } from "../api/types";
import type { WsClient } from "../api/ws";
import { FriendState, type FriendUpdated } from "../gen/v1/friends_pb";

interface FriendsStore {
  list: FriendsList;
  error: string | null;
  attach: (ws: WsClient) => Promise<void>;
  sendRequest: (username: string) => Promise<boolean>;
  accept: (userId: string) => Promise<void>;
  deleteRequest: (userId: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
}

const empty: FriendsList = { friends: [], incoming: [], outgoing: [] };
const lists = ["friends", "incoming", "outgoing"] as const;
const listFor: Record<JsonFriendState, (typeof lists)[number]> = {
  friend: "friends",
  incoming: "incoming",
  outgoing: "outgoing",
};

let stopListening: (() => void) | undefined;

export const useFriends = create<FriendsStore>()((set, get) => {
  function upsert(userId: string, entry: Friend | null) {
    const next = { ...get().list };
    for (const name of lists) next[name] = next[name].filter((f) => f.user.id !== userId);
    if (entry) next[listFor[entry.state]] = [entry, ...next[listFor[entry.state]]];
    set({ list: next });
  }

  function onFriendUpdated(update: FriendUpdated) {
    if (!update.user) return;
    const user = {
      id: update.user.id.toString(),
      username: update.user.username,
      display_name: update.user.displayName || null,
    };
    const state: JsonFriendState | null =
      update.state === FriendState.FRIEND
        ? "friend"
        : update.state === FriendState.INCOMING
          ? "incoming"
          : update.state === FriendState.OUTGOING
            ? "outgoing"
            : null;
    upsert(user.id, state ? { user, state, since: new Date().toISOString() } : null);
  }

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await action();
      set({ error: null });
      return result;
    } catch (e) {
      set({ error: (e as Error).message });
    }
  }

  return {
    list: empty,
    error: null,

    attach: async (ws) => {
      stopListening?.();
      stopListening = ws.addPushListener((payload) => {
        if (payload.case === "friendUpdated") onFriendUpdated(payload.value);
      });
      const list = await run(() => http<FriendsList>("/friends"));
      if (list) set({ list });
    },

    sendRequest: async (username) => {
      const entry = await run(() =>
        http<Friend>("/friends/requests", { method: "POST", body: { username } }),
      );
      if (entry) upsert(entry.user.id, entry);
      return !!entry;
    },

    accept: async (userId) => {
      const entry = await run(() =>
        http<Friend>(`/friends/requests/${userId}/accept`, { method: "POST" }),
      );
      if (entry) upsert(userId, entry);
    },

    deleteRequest: async (userId) => {
      const done = await run(() =>
        http<undefined>(`/friends/requests/${userId}`, { method: "DELETE" }).then(() => true),
      );
      if (done) upsert(userId, null);
    },

    removeFriend: async (userId) => {
      const done = await run(() =>
        http<undefined>(`/friends/${userId}`, { method: "DELETE" }).then(() => true),
      );
      if (done) upsert(userId, null);
    },
  };
});
