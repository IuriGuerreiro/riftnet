import { Check, MessageCircle, PhoneCall, Users, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { Friend } from "../../api/types";
import { AvatarWithStatus } from "../../components/AvatarWithStatus";
import { ConfirmDialog, IconButton, Tabs } from "../../components/ui";
import { useActivity } from "../../stores/activity";
import { useCalls } from "../../stores/calls";
import { useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { useFriends } from "../../stores/friends";
import { PresenceStatus, usePresence } from "../../stores/presence";
import { fromJson, nameOf, useProfiles } from "../../stores/profiles";
import { useUi } from "../../stores/ui";
import { activityText } from "../activity/activity";
import { AddFriend } from "./AddFriend";

type Tab = "online" | "all" | "pending" | "add";

export function FriendsPage() {
  const { list, error, accept, deleteRequest, removeFriend } = useFriends();
  const statuses = usePresence((s) => s.statuses);
  const profiles = useProfiles((s) => s.byId);
  const ws = useConnection((s) => s.ws);
  const openDm = useChat((s) => s.openDm);
  const showChat = useUi((s) => s.showChat);
  const activities = useActivity((s) => s.byId);
  const { current: call, error: callError, joinFriend } = useCalls();
  const [tab, setTab] = useState<Tab>("online");
  const [removing, setRemoving] = useState<Friend | null>(null);

  const name = (f: Friend) => nameOf(profiles[f.user.id] ?? fromJson(f.user));
  const isOnline = (f: Friend) =>
    (statuses[f.user.id] ?? PresenceStatus.OFFLINE) !== PresenceStatus.OFFLINE;
  const message = (f: Friend) => {
    if (!ws || !f.user.username) return;
    void openDm(ws, f.user.username);
    showChat();
  };
  const joinCall = async (f: Friend) => {
    if (!ws) return;
    await joinFriend(ws, BigInt(f.user.id));
    const joined = useCalls.getState().current;
    if (joined) {
      await useChat.getState().select(ws, joined.conversationId);
      showChat();
    }
  };

  const online = list.friends.filter(isOnline);
  const shown = tab === "online" ? online : list.friends;
  const pendingCount = list.incoming.length + list.outgoing.length;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface-2">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-surface-0 px-4 shadow-sm">
        <span className="flex items-center gap-2 font-semibold text-fg">
          <Users size={20} className="text-fg-subtle" />
          Friends
        </span>
        <span className="h-6 w-px bg-line" />
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "online", label: "Online" },
            { value: "all", label: "All" },
            {
              value: "pending",
              label: (
                <span className="flex items-center gap-1.5">
                  Pending
                  {list.incoming.length > 0 && (
                    <span className="rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">
                      {list.incoming.length}
                    </span>
                  )}
                </span>
              ),
            },
            { value: "add", label: "Add friend", accent: true },
          ]}
        />
      </header>

      {(error ?? callError) && (
        <p role="alert" className="bg-danger/15 px-4 py-2 text-sm text-danger">
          {error ?? callError}
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {tab === "add" ? (
          <AddFriend />
        ) : tab === "pending" ? (
          <>
            <ListHeading>Pending — {pendingCount}</ListHeading>
            {list.incoming.map((f) => (
              <FriendRow key={f.user.id} f={f} label={name(f)} sub="Incoming friend request">
                <IconButton
                  label="Accept"
                  icon={<Check size={20} />}
                  className="hover:text-success"
                  onClick={() => accept(f.user.id)}
                />
                <IconButton
                  label="Ignore"
                  tone="danger"
                  icon={<X size={20} />}
                  onClick={() => deleteRequest(f.user.id)}
                />
              </FriendRow>
            ))}
            {list.outgoing.map((f) => (
              <FriendRow key={f.user.id} f={f} label={name(f)} sub="Outgoing friend request">
                <IconButton
                  label="Cancel request"
                  tone="danger"
                  icon={<X size={20} />}
                  onClick={() => deleteRequest(f.user.id)}
                />
              </FriendRow>
            ))}
            {pendingCount === 0 && <Empty>There are no pending friend requests.</Empty>}
          </>
        ) : (
          <>
            <ListHeading>
              {tab === "online" ? "Online" : "All friends"} — {shown.length}
            </ListHeading>
            {shown.map((f) => (
              <FriendRow
                key={f.user.id}
                f={f}
                label={name(f)}
                sub={
                  profiles[f.user.id]?.customStatus ??
                  f.user.custom_status ??
                  (isOnline(f) ? "Online" : "Offline")
                }
                activity={activityText(activities[f.user.id])}
                onOpen={() => message(f)}
              >
                {activities[f.user.id]?.joinable && !call && ws && (
                  <IconButton
                    label="Join call"
                    icon={<PhoneCall size={20} />}
                    className="hover:text-success"
                    onClick={() => void joinCall(f)}
                  />
                )}
                <IconButton
                  label="Message"
                  icon={<MessageCircle size={20} />}
                  onClick={() => message(f)}
                />
                <IconButton
                  label="Remove friend"
                  tone="danger"
                  icon={<X size={20} />}
                  onClick={() => setRemoving(f)}
                />
              </FriendRow>
            ))}
            {shown.length === 0 && (
              <Empty>
                {tab === "online"
                  ? "No one's around right now."
                  : "No friends yet. Use Add friend to find people by username."}
              </Empty>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Remove ${name(removing)}` : "Remove friend"}
        confirmLabel="Remove friend"
        danger
        onConfirm={() => removing && removeFriend(removing.user.id)}
        onClose={() => setRemoving(null)}
      >
        Are you sure you want to remove{" "}
        <strong className="text-fg">{removing && name(removing)}</strong> from your friends?
      </ConfirmDialog>
    </section>
  );
}

function ListHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="pb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
      {children}
    </h2>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-16 text-center text-sm text-fg-subtle">{children}</p>;
}

function FriendRow({
  f,
  label,
  sub,
  activity,
  onOpen,
  children,
}: {
  f: Friend;
  label: string;
  sub: string;
  activity?: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-control border-t border-line px-2 py-2.5 hover:border-transparent hover:bg-surface-3">
      <button
        type="button"
        disabled={!onOpen}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <AvatarWithStatus userId={f.user.id} />
        <span className="min-w-0">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate font-semibold text-fg">{label}</span>
            {f.user.username && (
              <span className="hidden truncate text-sm text-fg-subtle group-hover:inline">
                @{f.user.username}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-fg-subtle">{sub}</span>
          {activity && (
            <span className="block truncate text-xs font-medium text-success" title={activity}>
              {activity}
            </span>
          )}
        </span>
      </button>
      <div className="flex gap-2 [&>button]:rounded-full [&>button]:bg-surface-1">{children}</div>
    </div>
  );
}
