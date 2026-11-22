import { create } from "zustand";

import type { User as JsonUser } from "../api/types";
import type { WsClient } from "../api/ws";
import type { User as ProtoUser } from "../gen/v1/users_pb";
import { useAuth } from "./auth";
import { useChat } from "./chat";
import { useFriends } from "./friends";

export interface Profile {
  id: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  customStatus: string | null;
  avatarHash: string | null;
  bannerHash: string | null;
  accentColor: string | null;
  pronouns: string | null;
  nameColor: string | null;
  statusEmoji: string | null;
  links: string[];
}

export function fromJson(u: JsonUser): Profile {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    bio: u.bio ?? null,
    customStatus: u.custom_status ?? null,
    avatarHash: u.avatar_hash ?? null,
    bannerHash: u.banner_hash ?? null,
    accentColor: u.accent_color ?? null,
    pronouns: u.pronouns ?? null,
    nameColor: u.name_color ?? null,
    statusEmoji: u.status_emoji ?? null,
    links: u.links ?? [],
  };
}

export function fromProto(u: ProtoUser): Profile {
  return {
    id: u.id.toString(),
    username: u.username || null,
    displayName: u.displayName || null,
    bio: u.bio || null,
    customStatus: u.customStatus || null,
    avatarHash: u.avatarHash || null,
    bannerHash: u.bannerHash || null,
    accentColor: u.accentColor || null,
    pronouns: u.pronouns || null,
    nameColor: u.nameColor || null,
    statusEmoji: u.statusEmoji || null,
    links: [...u.links],
  };
}

export function nameOf(p: Pick<Profile, "displayName" | "username" | "id"> | undefined): string {
  if (!p) return "Someone";
  return p.displayName ?? (p.username ? `@${p.username}` : p.id);
}

interface ProfilesStore {
  byId: Record<string, Profile>;
  put: (profiles: Profile[]) => void;
  attach: (ws: WsClient) => void;
}

let stopListening: (() => void) | undefined;

export const useProfiles = create<ProfilesStore>()((set, get) => ({
  byId: {},

  put: (profiles) => {
    const byId = get().byId;
    const changed = profiles.filter((p) => !same(byId[p.id], p));
    if (changed.length === 0) return;
    const next = { ...byId };
    for (const p of changed) next[p.id] = p;
    set({ byId: next });
  },

  attach: (ws) => {
    stopListening?.();
    stopListening = ws.addPushListener((payload) => {
      if (payload.case !== "userUpdated" || !payload.value.user) return;
      const pushed = payload.value.user;
      const p = fromProto(pushed);
      get().put([p]);
      patchSnapshots(pushed);
      const auth = useAuth.getState();
      if (auth.user?.id === p.id) {
        auth.setUser({
          ...auth.user,
          username: p.username,
          display_name: p.displayName,
          bio: p.bio,
          custom_status: p.customStatus,
          avatar_hash: p.avatarHash,
          banner_hash: p.bannerHash,
          accent_color: p.accentColor,
          pronouns: p.pronouns,
          name_color: p.nameColor,
          status_emoji: p.statusEmoji,
          links: p.links,
        });
      }
    });
  },
}));

function same(a: Profile | undefined, b: Profile): boolean {
  return (
    !!a &&
    a.username === b.username &&
    a.displayName === b.displayName &&
    a.bio === b.bio &&
    a.customStatus === b.customStatus &&
    a.avatarHash === b.avatarHash &&
    a.bannerHash === b.bannerHash &&
    a.accentColor === b.accentColor &&
    a.pronouns === b.pronouns &&
    a.nameColor === b.nameColor &&
    a.statusEmoji === b.statusEmoji &&
    a.links.length === b.links.length &&
    a.links.every((link, i) => link === b.links[i])
  );
}

export function useProfile(id: string | bigint | undefined): Profile | undefined {
  return useProfiles((s) => (id === undefined ? undefined : s.byId[id.toString()]));
}

function patchSnapshots(u: ProtoUser) {
  const id = u.id.toString();
  const chat = useChat.getState();
  if (chat.conversations.some((c) => c.members.some((m) => m.id === u.id))) {
    useChat.setState({
      conversations: chat.conversations.map((c) =>
        c.members.some((m) => m.id === u.id)
          ? { ...c, members: c.members.map((m) => (m.id === u.id ? u : m)) }
          : c,
      ),
    });
  }
  const { list } = useFriends.getState();
  const json = {
    id,
    username: u.username || null,
    display_name: u.displayName || null,
    bio: u.bio || null,
    custom_status: u.customStatus || null,
    avatar_hash: u.avatarHash || null,
    banner_hash: u.bannerHash || null,
    accent_color: u.accentColor || null,
    pronouns: u.pronouns || null,
    name_color: u.nameColor || null,
    status_emoji: u.statusEmoji || null,
    links: [...u.links],
  };
  const patch = (rows: typeof list.friends) =>
    rows.map((f) => (f.user.id === id ? { ...f, user: json } : f));
  if ([...list.friends, ...list.incoming, ...list.outgoing].some((f) => f.user.id === id)) {
    useFriends.setState({
      list: {
        friends: patch(list.friends),
        incoming: patch(list.incoming),
        outgoing: patch(list.outgoing),
      },
    });
  }
}

useAuth.subscribe((s, prev) => {
  if (prev.refreshToken && !s.refreshToken) useProfiles.setState({ byId: {} });
});
