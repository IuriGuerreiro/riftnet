import {
  BellOff,
  ChevronDown,
  Hash,
  Inbox,
  LogOut,
  Megaphone,
  Pin,
  Plus,
  Settings,
  UserPlus,
  Volume2,
  VolumeX,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { Avatar, AvatarStack } from "@/components/Avatar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ActivityLine } from "@/features/adept/ActivityLine";
import { UserCallMenu } from "@/features/adept/UserCallMenu";
import { useSpeaker } from "@/features/adept/useSpeaker";
import { getDraft } from "@/features/chat/drafts";
import { searchPeople } from "@/features/dialogs/HomeDialogs";
import { EmojiText } from "@/features/emoji/EmojiText";
import { ProfileTrigger } from "@/features/profile/ProfileCard";
import { ConversationAvatar } from "@/features/shell/ConversationRow";
import { cn } from "@/lib/utils";
import {
  type Conversation,
  CONVERSATIONS,
  LIVE_ROOMS,
  type LiveRoom,
  ME,
  type Server,
  server as findServer,
  user,
} from "@/mock/data";
import {
  addFriend,
  answerRequest,
  cancelRequest,
  change,
  ensureDm,
  friendState,
  isOwner,
  isSilenced,
  openDialog,
  removeServer,
  toggleMuted,
  useWorld,
  world,
} from "@/mock/world";

export type UnreadOf = (id: string, base: number) => number;

export function mentionsIn(s: Server, unreadOf: UnreadOf) {
  return s.channels.reduce(
    (n, c) => n + (unreadOf(c.id, c.unread ?? 0) ? (c.mentions ?? 0) : 0),
    0,
  );
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2 pt-4 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
      <span className="flex items-center gap-1.5">{children}</span>
      {action}
    </div>
  );
}

function MentionPill({ count }: { count: number }) {
  return (
    <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-danger-fill px-1.5 text-[11px] font-bold text-white">
      {count}
    </span>
  );
}

function UnreadDot() {
  return <span className="size-2 shrink-0 rounded-full bg-brand" />;
}

export function RailTile({
  label,
  active,
  unread,
  mentions,
  voice,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  unread?: boolean;
  mentions?: number;
  voice?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group/tile relative flex w-full justify-center">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        className={cn(
          "relative rounded-[28%] outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
          active && "ring-[1.5px] ring-brand ring-offset-2 ring-offset-ink",
        )}
      >
        <span
          className={cn(
            "block transition-[opacity,filter] duration-150",
            active
              ? ""
              : "opacity-75 saturate-[.8] group-hover/tile:opacity-100 group-hover/tile:saturate-100",
          )}
        >
          {children}
        </span>
        {unread && !active && !mentions && (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-foreground ring-[2.5px] ring-ink" />
        )}
        {mentions ? (
          <span className="absolute -top-1 -right-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-danger-fill px-1 text-[10px] leading-none font-bold text-white tabular-nums ring-2 ring-ink">
            {mentions}
          </span>
        ) : null}
        {voice && (
          <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-surface-2 text-success ring-2 ring-ink">
            <Volume2 className="size-2.5" strokeWidth={2.5} />
          </span>
        )}
      </button>
    </div>
  );
}

function LiveRow({
  room,
  joined,
  previewing,
  onPreview,
  onJoin,
}: {
  room: LiveRoom;
  joined: boolean;
  previewing: boolean;
  onPreview: () => void;
  onJoin: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-2 py-1.5 transition-colors",
        previewing ? "bg-surface-2 ring-1 ring-white/[0.06] ring-inset" : "hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPreview}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <Volume2 className="size-3.5 shrink-0 text-success" />
          <span className="truncate text-[13px] font-medium">{room.name}</span>
        </button>
        {joined ? (
          <span className="grid h-6 w-12 shrink-0 place-items-center rounded-md bg-success/15 text-[11px] font-semibold text-success">
            Joined
          </span>
        ) : (
          <button
            type="button"
            onClick={onJoin}
            className="grid h-6 w-12 shrink-0 place-items-center rounded-md bg-surface-2 text-[11px] font-semibold text-foreground/85 transition-colors hover:bg-success hover:text-ink"
          >
            Join
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onPreview}
        tabIndex={-1}
        className="mt-1 flex w-full items-center gap-1.5 pl-5 text-left"
      >
        {room.live && (
          <span className="shrink-0 rounded bg-danger-fill px-1 py-px text-[9px] leading-tight font-bold tracking-wide text-white">
            LIVE
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {findServer(room.serverId)?.name}
        </span>
        <AvatarStack ids={room.people} size={18} max={3} />
      </button>
    </div>
  );
}

function DmRow({
  c,
  active,
  unreadOf,
  onRead,
  onClick,
}: {
  c: Conversation;
  active: boolean;
  unreadOf: UnreadOf;
  onRead: () => void;
  onClick: () => void;
}) {
  const u = user(c.members[0] ?? "");
  const unread = unreadOf(c.id, c.unread) > 0 && !active;
  const muted = world.muted.has(c.id);
  const draft = !active && getDraft(c.id).text;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          onClick={onClick}
          className={cn(
            "group/row flex min-h-[42px] w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
            active ? "bg-surface-2 ring-1 ring-white/[0.06] ring-inset" : "hover:bg-white/[0.04]",
          )}
        >
          {c.kind === "group" ? (
            <ConversationAvatar c={c} size={32} />
          ) : (
            <span className={cn(u.status === "offline" && "opacity-60 group-hover/row:opacity-90")}>
              <Avatar id={u.id} size={32} status />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-[13.5px] leading-snug",
                active || (unread && !muted)
                  ? "font-semibold text-foreground"
                  : muted
                    ? "text-muted-foreground/60"
                    : "text-foreground/70 group-hover/row:text-foreground/90",
              )}
            >
              <EmojiText text={c.title} size={16} />
            </span>
            {draft ? (
              <span className="block truncate text-xs text-brand-text">Draft: {draft}</span>
            ) : c.kind === "group" ? (
              <span className="block truncate text-xs text-muted-foreground">
                {c.members.length + 1} members
              </span>
            ) : u.activity ? (
              <ActivityLine a={u.activity} />
            ) : null}
          </span>
          {c.mentions > 0 && unread ? (
            <MentionPill count={c.mentions} />
          ) : unread && !muted ? (
            <UnreadDot />
          ) : null}
          {muted && (
            <BellOff aria-label="Muted" className="size-3.5 shrink-0 text-muted-foreground/50" />
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem
          onSelect={() =>
            change(() => {
              c.pinned = !c.pinned;
            })
          }
        >
          {c.pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => toggleMuted(c.id)}>
          {muted ? "Unmute" : "Mute"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onRead}>Mark as read</ContextMenuItem>
        {c.kind === "dm" && (
          <ContextMenuItem onSelect={() => change(() => world.closed.add(c.id))}>
            Close chat
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export type HomeTab = "chats" | "friends" | "requests";

export function HomeSidebar({
  tab,
  setTab,
  active,
  onOpen,
  joined,
  preview,
  onPreview,
  onJoin,
  unreadOf,
  onRead,
}: {
  unreadOf: UnreadOf;
  onRead: (id: string) => void;
  tab: HomeTab;
  setTab: (t: HomeTab) => void;
  active: string;
  onOpen: (id: string) => void;
  joined: string | null;
  preview: string | null;
  onPreview: (id: string) => void;
  onJoin: (id: string) => void;
}) {
  useWorld();
  const [query, setQuery] = useState("");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const dms = world.empty
    ? []
    : CONVERSATIONS.filter((c) => c.kind !== "channel" && !world.closed.has(c.id));
  const pinned = dms.filter((c) => c.pinned);
  const rest = dms.filter((c) => !c.pinned);
  const rooms = world.empty ? [] : LIVE_ROOMS.filter((r) => findServer(r.serverId));
  const friends = world.empty
    ? []
    : [...world.friends]
        .map(user)
        .filter((f) => !onlineOnly || f.status !== "offline")
        .sort((a, b) => Number(a.status === "offline") - Number(b.status === "offline"));
  const people = searchPeople(query);

  return (
    <>
      <div className="px-2 pt-1">
        <div
          role="tablist"
          aria-label="Home"
          className="flex items-center gap-0.5 rounded-lg bg-surface-1/80 p-0.5 ring-1 ring-white/[0.05] ring-inset"
        >
          {(["chats", "friends", "requests"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "flex h-7 flex-auto items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium capitalize transition-colors",
                tab === t
                  ? "bg-surface-2 text-foreground ring-1 ring-white/[0.07] ring-inset"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
              {t === "requests" && world.incoming.length > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand/20 px-1 text-[10px] leading-none font-semibold text-brand-text tabular-nums">
                  {world.incoming.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {tab === "chats" && (
          <>
            {rooms.length > 0 && (
              <SectionLabel>
                <span className="relative flex size-1.5">
                  <span className="relative inline-flex size-1.5 rounded-full bg-success" />
                </span>
                Live now
              </SectionLabel>
            )}
            {rooms.map((r) => (
              <LiveRow
                key={r.channelId}
                room={r}
                joined={joined === r.channelId}
                previewing={preview === r.channelId}
                onPreview={() => onPreview(r.channelId)}
                onJoin={() => onJoin(r.channelId)}
              />
            ))}
            {pinned.length > 0 && (
              <SectionLabel>
                <Pin className="size-3" />
                Pinned
              </SectionLabel>
            )}
            {pinned.map((c) => (
              <DmRow
                key={c.id}
                c={c}
                active={active === c.id}
                unreadOf={unreadOf}
                onRead={() => onRead(c.id)}
                onClick={() => onOpen(c.id)}
              />
            ))}
            <SectionLabel
              action={
                <button
                  type="button"
                  aria-label="New message"
                  title="New message"
                  onClick={() => openDialog({ kind: "newDm" })}
                  className="rounded p-0.5 hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              }
            >
              Messages
            </SectionLabel>
            {rest.map((c) => (
              <DmRow
                key={c.id}
                c={c}
                active={active === c.id}
                unreadOf={unreadOf}
                onRead={() => onRead(c.id)}
                onClick={() => onOpen(c.id)}
              />
            ))}
            {dms.length === 0 && (
              <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                <p>No chats yet. Add a friend to start talking.</p>
                <button
                  type="button"
                  onClick={() => setTab("friends")}
                  className="mt-3 h-8 rounded-lg bg-brand-fill px-3 text-xs font-semibold text-white"
                >
                  Add a friend
                </button>
              </div>
            )}
          </>
        )}
        {tab === "friends" && (
          <>
            <div className="relative mt-3">
              <UserPlus className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Find people by name or @username"
                placeholder="Find people by name or @username"
                className="h-9 w-full rounded-lg border border-border bg-surface-1 pr-2 pl-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </div>
            {query.trim().length > 1 && people.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">No matching people.</p>
            )}
            {people.map((p) => {
              const state = friendState(p.id);
              return (
                <div key={p.id} className="flex h-12 items-center gap-2.5 px-2 text-sm">
                  <Avatar id={p.id} size={28} />
                  <span className="min-w-0 flex-1 truncate">
                    {p.name}
                    <span className="block truncate text-xs text-muted-foreground">
                      @{p.handle}
                    </span>
                  </span>
                  {state === "friend" ? (
                    <span className="text-xs text-success">Friend</span>
                  ) : (
                    <button
                      type="button"
                      disabled={world.blocked.has(p.id)}
                      onClick={() => (state === "outgoing" ? cancelRequest(p.id) : addFriend(p.id))}
                      className="h-7 rounded-md bg-surface-3 px-2.5 text-xs font-medium hover:bg-surface-4"
                    >
                      {state === "outgoing" ? "Cancel" : state === "incoming" ? "Accept" : "Add"}
                    </button>
                  )}
                </div>
              );
            })}
            <SectionLabel
              action={
                <button
                  type="button"
                  aria-pressed={onlineOnly}
                  onClick={() => setOnlineOnly(!onlineOnly)}
                  className="normal-case hover:text-foreground"
                >
                  {onlineOnly ? "Show all" : "Online only"}
                </button>
              }
            >
              {onlineOnly ? "Online" : "All friends"} — {friends.length}
            </SectionLabel>
            {friends.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setTab("chats");
                  onOpen(ensureDm(f.id));
                }}
                className={cn(
                  "flex min-h-[42px] w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]",
                  f.status === "offline" && "text-muted-foreground",
                )}
              >
                <Avatar id={f.id} size={32} status />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{f.name}</span>
                  {f.activity ? (
                    <ActivityLine a={f.activity} />
                  ) : (
                    <span className="block text-xs text-muted-foreground">@{f.handle}</span>
                  )}
                </span>
              </button>
            ))}
          </>
        )}
        {tab === "requests" && (
          <>
            {world.incoming.length > 0 && <SectionLabel>Received</SectionLabel>}
            {world.incoming.map((id) => (
              <div key={id} className="mb-2 rounded-xl border border-border bg-surface-1 p-3">
                <div className="flex items-center gap-2.5">
                  <Avatar id={id} size={32} />
                  <p className="text-sm font-medium">
                    {user(id).name}
                    <span className="block text-xs font-normal text-muted-foreground">
                      @{user(id).handle}
                    </span>
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => answerRequest(id, true)}
                    className="h-8 rounded-lg bg-brand-fill text-xs font-semibold text-white hover:bg-brand-fill/85"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => answerRequest(id, false)}
                    className="h-8 rounded-lg bg-surface-3 text-xs font-medium hover:bg-surface-4"
                  >
                    Ignore
                  </button>
                </div>
              </div>
            ))}
            {world.outgoing.length > 0 && <SectionLabel>Sent</SectionLabel>}
            {world.outgoing.map((id) => (
              <div key={id} className="flex h-12 items-center gap-2.5 px-2 text-sm">
                <Avatar id={id} size={28} />
                <span className="flex-1">{user(id).name}</span>
                <button
                  type="button"
                  onClick={() => cancelRequest(id)}
                  className="h-7 rounded-md bg-surface-3 px-2.5 text-xs font-medium hover:bg-surface-4"
                >
                  Cancel
                </button>
              </div>
            ))}
            {world.incoming.length + world.outgoing.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
                <Inbox className="size-8 text-surface-4" />
                <p className="text-sm font-medium">No pending requests</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function VoiceMember({ id, live }: { id: string; live: boolean }) {
  const speaking = useSpeaker(world.speakingIn) === id && !isSilenced(id);
  return (
    <UserCallMenu id={id}>
      <div className="flex h-7 items-center gap-2 rounded-md pr-2 pl-7 text-[13px] hover:bg-white/[0.04]">
        <ProfileTrigger
          id={id}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 text-left transition-colors",
            speaking
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span
            className={cn(
              "inline-flex rounded-full transition-shadow duration-150",
              speaking && "ring-[1.5px] ring-success ring-offset-[1.5px] ring-offset-ink",
            )}
          >
            <Avatar id={id} size={20} />
          </span>
          <span className="truncate">{user(id).name}</span>
        </ProfileTrigger>
        {isSilenced(id) && (
          <VolumeX aria-label="Muted for you" className="size-3.5 shrink-0 text-destructive/80" />
        )}
        {live && (
          <span className="rounded bg-danger-fill px-1 py-px text-[9px] leading-tight font-bold text-white">
            LIVE
          </span>
        )}
      </div>
    </UserCallMenu>
  );
}

export function ServerSidebar({
  s,
  active,
  onOpen,
  joined,
  preview,
  onPreview,
  unreadOf,
}: {
  unreadOf: UnreadOf;
  s: Server;
  active: string;
  onOpen: (id: string) => void;
  joined: string | null;
  preview: string | null;
  onPreview: (id: string) => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const categories = [...new Set(s.channels.map((c) => c.category))];
  useWorld();
  const owner = isOwner(s);
  const online = s.members.filter((id) => user(id).status !== "offline").length;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="mx-2 flex h-11 shrink-0 items-center gap-2 rounded-lg px-2 text-left hover:bg-accent/60"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{s.name}</span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-success" />
                {online} online · {s.members.length} members
              </span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuItem onSelect={() => openDialog({ kind: "invite", server: s.id })}>
            <UserPlus /> Invite people
          </DropdownMenuItem>
          {owner && (
            <>
              <DropdownMenuItem onSelect={() => openDialog({ kind: "channel", server: s.id })}>
                <Plus /> Create channel
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => openDialog({ kind: "serverSettings", server: s.id })}
              >
                <Settings /> Server settings
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={() => toggleMuted(s.id)}>
            <BellOff /> {world.muted.has(s.id) ? "Unmute server" : "Mute server"}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={owner}
            onSelect={() =>
              openDialog({
                kind: "confirm",
                title: `Leave ${s.name}?`,
                body: "You need a new invite to come back.",
                action: "Leave server",
                run: () => removeServer(s.id),
              })
            }
          >
            <LogOut /> {owner ? "Owners can't leave yet" : "Leave server"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {categories.map((cat) => {
          const isClosed = closed.has(cat);
          return (
            <div key={cat}>
              <button
                type="button"
                onClick={() =>
                  setClosed((prev) => {
                    const next = new Set(prev);
                    if (next.has(cat)) next.delete(cat);
                    else next.add(cat);
                    return next;
                  })
                }
                aria-expanded={!isClosed}
                className="flex w-full items-center gap-1 px-1 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground"
              >
                <ChevronDown
                  className={cn("size-3 transition-transform", isClosed && "-rotate-90")}
                />
                {cat}
              </button>
              {s.channels
                .filter((c) => c.category === cat)
                .filter((c) => !isClosed || active === c.id || (c.voice?.length ?? 0) > 0)
                .map((c) => {
                  const isActive = active === c.id || preview === c.id;
                  const unread = unreadOf(c.id, c.unread ?? 0) > 0 && !isActive;
                  return (
                    <div key={c.id} className="group/ch relative">
                      <button
                        type="button"
                        onClick={() => (c.kind === "text" ? onOpen(c.id) : onPreview(c.id))}
                        className={cn(
                          "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors",
                          isActive
                            ? "bg-accent font-semibold text-foreground"
                            : unread
                              ? "font-semibold text-foreground hover:bg-accent/60"
                              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                        )}
                      >
                        {c.kind === "text" ? (
                          c.readOnly ? (
                            <Megaphone className="size-4 shrink-0 opacity-60" />
                          ) : (
                            <Hash className="size-4 shrink-0 opacity-60" />
                          )
                        ) : (
                          <Volume2
                            className={cn(
                              "size-4 shrink-0",
                              (c.voice?.length ?? 0) > 0 ? "text-success" : "opacity-60",
                            )}
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        {joined === c.id && (
                          <span className="text-[11px] font-semibold text-success">In</span>
                        )}
                        {c.mentions && unread ? (
                          <MentionPill count={c.mentions} />
                        ) : unread ? (
                          <UnreadDot />
                        ) : null}
                      </button>
                      {owner && (
                        <button
                          type="button"
                          aria-label={`Edit ${c.name}`}
                          title="Edit channel"
                          onClick={() =>
                            openDialog({ kind: "channel", server: s.id, channel: c.id })
                          }
                          className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md bg-surface-3 text-muted-foreground opacity-0 group-hover/ch:opacity-100 hover:text-foreground focus-visible:opacity-100"
                        >
                          <Settings className="size-3.5" />
                        </button>
                      )}
                      {c.voice?.map((id) => (
                        <VoiceMember key={id} id={id} live={c.live === id} />
                      ))}
                      {joined === c.id && (
                        <div className="flex h-7 items-center gap-2 pr-2 pl-8 text-[13px] text-foreground">
                          <Avatar id={ME} size={18} />
                          <span className="truncate">{user(ME).name}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </>
  );
}
