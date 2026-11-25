import { ChevronDown, Compass, Hash, Inbox, Pin, Plus, Radio, Search, Volume2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Avatar, AvatarStack } from "@/components/Avatar";
import { AdeptMark } from "@/components/brand/AdeptMark";
import { ServerIcon } from "@/components/ServerIcon";
import { ActivityLine } from "@/features/adept/ActivityLine";
import { CallCard } from "@/features/adept/CallCard";
import { CallStage, type CallState } from "@/features/adept/CallStage";
import { PeoplePanel } from "@/features/adept/PeoplePanel";
import { ProfilePanel } from "@/features/adept/ProfilePanel";
import { RoomPreview } from "@/features/adept/RoomPreview";
import { StreamPip } from "@/features/adept/StreamPip";
import { type RequestState, TopBarStatus } from "@/features/adept/TopBarStatus";
import { ChatView } from "@/features/chat/ChatView";
import { EmojiText } from "@/features/emoji/EmojiText";
import { ConversationAvatar } from "@/features/shell/ConversationRow";
import { JumpPalette } from "@/features/shell/JumpPalette";
import { UserBar } from "@/features/shell/UserBar";
import { cn } from "@/lib/utils";
import {
  type Conversation,
  conversation,
  CONVERSATIONS,
  FRIENDS,
  LIVE_ROOMS,
  type LiveRoom,
  ME,
  type Server,
  server as findServer,
  SERVERS,
  user,
} from "@/mock/data";

type UnreadOf = (id: string, base: number) => number;

const WIDE = "(min-width: 1100px)";

const DMS = CONVERSATIONS.filter((c) => c.kind !== "channel");

function mentionsIn(s: Server, unreadOf: UnreadOf) {
  return s.channels.reduce((n, c) => n + (unreadOf(c.id, 1) ? (c.mentions ?? 0) : 0), 0);
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

function RailTile({
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
    <div className="relative flex w-full justify-center">
      {unread && !active && (
        <span className="absolute top-1/2 left-0 size-1.5 -translate-y-1/2 rounded-full bg-brand" />
      )}
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        className={cn(
          "relative rounded-xl transition-all duration-150",
          active
            ? "ring-2 ring-brand ring-offset-2 ring-offset-ink"
            : "opacity-80 hover:-translate-y-px hover:opacity-100",
        )}
      >
        {children}
        {mentions ? (
          <span className="absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-ink bg-danger-fill px-1 text-[10px] font-bold text-white">
            {mentions}
          </span>
        ) : null}
        {voice && (
          <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full border-2 border-ink bg-success">
            <Volume2 className="size-2 text-ink" strokeWidth={3} />
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
        "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
        previewing ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <button
        type="button"
        onClick={onPreview}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <Volume2 className="size-4 shrink-0 text-success" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{room.name}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {room.live && (
              <span className="flex shrink-0 items-center gap-0.5 rounded bg-danger-fill px-1 text-[9px] font-bold text-white">
                <Radio className="size-2.5" />
                LIVE
              </span>
            )}
            <span className="truncate">{findServer(room.serverId)?.name}</span>
          </span>
        </span>
        <AvatarStack ids={room.people} size={18} max={3} ringBg="var(--adept-ink)" />
      </button>
      {joined ? (
        <span className="text-[11px] font-semibold text-success">In</span>
      ) : (
        <button
          type="button"
          onClick={onJoin}
          className="h-6 shrink-0 rounded-md bg-success/15 px-2 text-[11px] font-semibold text-success transition-colors hover:bg-success hover:text-ink"
        >
          Join
        </button>
      )}
    </div>
  );
}

function DmRow({
  c,
  active,
  unreadOf,
  onClick,
}: {
  c: Conversation;
  active: boolean;
  unreadOf: UnreadOf;
  onClick: () => void;
}) {
  const u = user(c.members[0] ?? "");
  const unread = unreadOf(c.id, c.unread) > 0 && !active;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-12 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      {c.kind === "group" ? (
        <ConversationAvatar c={c} size={32} />
      ) : (
        <Avatar id={u.id} size={32} status ringBg="var(--adept-ink)" />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm",
            unread || active ? "font-semibold text-foreground" : "font-medium text-foreground/75",
          )}
        >
          <EmojiText text={c.title} size={16} />
        </span>
        {c.kind === "group" ? (
          <span className="block truncate text-xs text-muted-foreground">
            {c.members.length + 1} members
          </span>
        ) : u.activity ? (
          <ActivityLine a={u.activity} />
        ) : null}
      </span>
      {c.mentions > 0 && unread ? (
        <MentionPill count={c.mentions} />
      ) : unread ? (
        <UnreadDot />
      ) : null}
    </button>
  );
}

type HomeTab = "chats" | "friends" | "requests";

function HomeSidebar({
  tab,
  setTab,
  active,
  onOpen,
  joined,
  preview,
  onPreview,
  onJoin,
  unreadOf,
  request,
  onRequest,
}: {
  unreadOf: UnreadOf;
  request: RequestState;
  onRequest: (r: RequestState) => void;
  tab: HomeTab;
  setTab: (t: HomeTab) => void;
  active: string;
  onOpen: (id: string) => void;
  joined: string | null;
  preview: string | null;
  onPreview: (id: string) => void;
  onJoin: (id: string) => void;
}) {
  const pinned = DMS.filter((c) => c.pinned);
  const rest = DMS.filter((c) => !c.pinned);
  const friends = FRIENDS.filter((f) => f.id !== "rui" || request === "accepted").sort(
    (a, b) => Number(a.status === "offline") - Number(b.status === "offline"),
  );

  return (
    <>
      <div className="px-2 pt-1">
        <div className="grid grid-cols-3 rounded-lg bg-surface-1 p-0.5">
          {(["chats", "friends", "requests"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "h-7 rounded-md text-xs font-medium capitalize transition-colors",
                tab === t
                  ? "bg-surface-3 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
              {t === "requests" && request === "pending" && (
                <span className="ml-1 text-brand-text">1</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {tab === "chats" && (
          <>
            <SectionLabel>
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex size-1.5 rounded-full bg-success" />
              </span>
              Live now
            </SectionLabel>
            {LIVE_ROOMS.map((r) => (
              <LiveRow
                key={r.channelId}
                room={r}
                joined={joined === r.channelId}
                previewing={preview === r.channelId}
                onPreview={() => onPreview(r.channelId)}
                onJoin={() => onJoin(r.channelId)}
              />
            ))}
            <SectionLabel>
              <Pin className="size-3" />
              Pinned
            </SectionLabel>
            {pinned.map((c) => (
              <DmRow
                key={c.id}
                c={c}
                active={active === c.id}
                unreadOf={unreadOf}
                onClick={() => onOpen(c.id)}
              />
            ))}
            <SectionLabel
              action={<Plus className="size-3.5 cursor-pointer hover:text-foreground" />}
            >
              Direct messages
            </SectionLabel>
            {rest.map((c) => (
              <DmRow
                key={c.id}
                c={c}
                active={active === c.id}
                unreadOf={unreadOf}
                onClick={() => onOpen(c.id)}
              />
            ))}
          </>
        )}
        {tab === "friends" && (
          <>
            <SectionLabel>All friends — {friends.length}</SectionLabel>
            {friends.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setTab("chats");
                  onOpen(`dm-${f.id}`);
                }}
                className={cn(
                  "flex h-12 w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-accent/60",
                  f.status === "offline" && "opacity-45",
                )}
              >
                <Avatar id={f.id} size={32} status ringBg="var(--adept-ink)" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{f.name}</span>
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
        {tab === "requests" && request === "pending" && (
          <div className="mt-3 rounded-xl border border-border bg-surface-1 p-3">
            <div className="flex items-center gap-2.5">
              <Avatar id="rui" size={32} />
              <p className="text-sm font-medium">
                {user("rui").name}
                <span className="block text-xs font-normal text-muted-foreground">
                  wants to be friends
                </span>
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onRequest("accepted")}
                className="h-8 rounded-lg bg-brand-fill text-xs font-semibold text-white hover:bg-brand-fill/85"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => onRequest("ignored")}
                className="h-8 rounded-lg bg-surface-3 text-xs font-medium hover:bg-surface-4"
              >
                Ignore
              </button>
            </div>
          </div>
        )}
        {tab === "requests" && request !== "pending" && (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
            <Inbox className="size-8 text-surface-4" />
            <p className="text-sm font-medium">No pending requests</p>
            <p className="text-xs text-muted-foreground">
              Friend requests and message requests land here.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function ServerSidebar({
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
  const online = s.members.filter((id) => user(id).status !== "offline").length;

  return (
    <>
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
                    <div key={c.id}>
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
                          <Hash className="size-4 shrink-0 opacity-60" />
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
                      {c.voice?.map((id) => (
                        <div
                          key={id}
                          className="flex h-7 items-center gap-2 pr-2 pl-8 text-[13px] text-muted-foreground"
                        >
                          <Avatar id={id} size={18} />
                          <span className="min-w-0 flex-1 truncate">{user(id).name}</span>
                          {c.live === id && (
                            <span className="rounded bg-danger-fill px-1 text-[9px] font-bold text-white">
                              LIVE
                            </span>
                          )}
                        </div>
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

export function AdeptLayout() {
  const [place, setPlace] = useState("home");
  const [openIn, setOpenIn] = useState<Record<string, string>>({
    home: "dm-maya",
    owls: "owls-general",
    forge: "forge-dev",
    drift: "drift-scrims",
    books: "books-general",
  });
  const [tab, setTab] = useState<HomeTab>("chats");
  const [call, setCall] = useState<CallState | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({ "dm-maya": 0 });
  const [request, setRequest] = useState<RequestState>("pending");
  const [preview, setPreview] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia(WIDE).matches);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const onChange = () => setPanelOpen(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const ringing = call?.ringing ?? false;
  useEffect(() => {
    if (!ringing) return;
    const timer = setTimeout(
      () => setCall((x) => x && { ...x, ringing: false, startedAt: Date.now() }),
      3500,
    );
    return () => clearTimeout(timer);
  }, [ringing, call?.id]);

  const joined = call?.id ?? null;
  const unreadOf: UnreadOf = (id, base) => counts[id] ?? base;
  const markUnread = (id: string, n: number) => setCounts((x) => ({ ...x, [id]: n }));
  const s = SERVERS.find((x) => x.id === place);
  const activeId = openIn[place] ?? "dm-maya";
  const c = conversation(activeId);
  const chatServer = c.serverId ? findServer(c.serverId) : undefined;
  const rooms = SERVERS.flatMap((srv) =>
    srv.channels
      .filter((channel) => channel.kind === "voice")
      .map((channel) => ({
        channelId: channel.id,
        serverId: srv.id,
        name: channel.name,
        people: channel.voice ?? [],
        live: channel.live,
      })),
  );
  const callTarget = joined ? conversation(joined) : undefined;
  const callConversation = callTarget?.kind === "channel" ? undefined : callTarget;
  const joinedBase: LiveRoom | undefined = callConversation
    ? {
        channelId: callConversation.id,
        serverId: "",
        name: callConversation.title,
        people: callConversation.members,
        live: undefined,
      }
    : rooms.find((r) => r.channelId === joined);
  const joinedRoom = joinedBase && {
    ...joinedBase,
    people: [...new Set([...joinedBase.people, ME])],
  };
  const inStage = joinedRoom !== undefined && preview === joined;
  const hasStream = sharing || joinedRoom?.live !== undefined;
  const previewRoom = rooms.find((r) => r.channelId === preview);
  const dmMentions = DMS.reduce((n, x) => n + (unreadOf(x.id, x.unread) ? x.mentions : 0), 0);

  const openConversation = (id: string) => {
    const conv = conversation(id);
    const where = conv.kind === "channel" ? (conv.serverId ?? "home") : "home";
    setPlace(where);
    setOpenIn((o) => ({ ...o, [where]: id }));
    markUnread(id, 0);
    setPreview(null);
    setPalette(false);
  };
  const go = (where: string) => {
    setPlace(where);
    setPreview(null);
    const id = openIn[where];
    if (id) markUnread(id, 0);
  };
  const openVoice = (id: string) => {
    const room = rooms.find((r) => r.channelId === id);
    if (room) go(room.serverId);
    setPreview(id);
    setPalette(false);
  };
  const connect = (id: string, direct: boolean, camera: boolean) => {
    setPreview(id);
    setPalette(false);
    if (id === joined) return;
    setCall({
      id,
      startedAt: Date.now(),
      camera,
      focused: null,
      ringing: direct,
      previewHidden: false,
    });
    setSharing(false);
  };
  const join = (id: string) => connect(id, false, false);
  const startCall = (video: boolean) => connect(activeId, true, video);
  const patchCall = (patch: Partial<CallState>) => setCall((x) => x && { ...x, ...patch });
  const leave = () => {
    setCall(null);
    setSharing(false);
    setPreview(null);
  };
  const toggleMute = () => {
    if (deafened) {
      setDeafened(false);
      setMuted(false);
    } else setMuted((value) => !value);
  };
  const toggleDeafen = () => setDeafened((value) => !value);
  const toggleShare = () => {
    setSharing((value) => !value);
    patchCall({ previewHidden: false });
  };

  return (
    <div className="flex h-full flex-col bg-ink">
      <header className="grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_minmax(120px,300px)_auto] xl:grid-cols-[1fr_minmax(0,440px)_1fr] items-center gap-4 px-3">
        <div className="flex min-w-0 items-center gap-2.5 text-sm">
          <AdeptMark className="size-5" />
          <span className="truncate text-muted-foreground">
            {inStage
              ? (findServer(joinedRoom.serverId)?.name ?? "Home")
              : chatServer
                ? chatServer.name
                : "Home"}
            <span className="px-1.5 text-surface-4">/</span>
            <span className="font-medium text-foreground">
              {inStage && <Volume2 className="mr-1 inline size-3.5 text-success" />}
              <EmojiText
                text={inStage ? joinedRoom.name : c.kind === "channel" ? `# ${c.title}` : c.title}
                size={15}
              />
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="flex h-7 items-center gap-2 rounded-lg border border-white/[0.06] bg-surface-1 px-3 text-xs text-muted-foreground transition-colors hover:border-white/10 hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="min-w-0 flex-1 truncate text-left">
            Jump to a chat, channel or person
          </span>
          <kbd className="shrink-0 whitespace-nowrap rounded bg-surface-3 px-1.5 text-[10px]">
            Ctrl K
          </kbd>
        </button>
        <TopBarStatus
          onOpen={openConversation}
          onFriends={() => {
            go("home");
            setTab("friends");
          }}
          request={request}
          onRequest={setRequest}
          onLive={() => {
            go("home");
            setTab("chats");
          }}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[60px] shrink-0 flex-col items-center gap-3 overflow-y-auto pt-1 pb-3">
          <RailTile
            label="Home"
            active={place === "home"}
            mentions={dmMentions}
            onClick={() => go("home")}
          >
            <span
              className={cn(
                "grid size-10 place-items-center rounded-xl transition-colors",
                place === "home" ? "bg-brand/20" : "bg-surface-2",
              )}
            >
              <AdeptMark className="size-6" />
            </span>
          </RailTile>
          <span className="h-px w-6 bg-surface-3" />
          {SERVERS.map((srv) => (
            <RailTile
              key={srv.id}
              label={srv.name}
              active={place === srv.id}
              unread={srv.channels.some((x) => unreadOf(x.id, x.unread ?? 0) > 0)}
              mentions={mentionsIn(srv, unreadOf)}
              voice={srv.channels.some((x) => (x.voice?.length ?? 0) > 0)}
              onClick={() => go(srv.id)}
            >
              <ServerIcon server={srv} size={40} className="rounded-xl" />
            </RailTile>
          ))}
          <div className="mt-auto flex flex-col items-center gap-2 pt-3">
            <button
              type="button"
              aria-label="Add a server"
              title="Add a server"
              className="grid size-10 place-items-center rounded-xl border border-dashed border-surface-4 text-muted-foreground transition-colors hover:border-brand hover:text-brand-text"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Explore"
              title="Explore"
              className="grid size-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Compass className="size-[18px]" />
            </button>
          </div>
        </nav>

        <aside className="flex w-[248px] shrink-0 flex-col">
          {s ? (
            <ServerSidebar
              s={s}
              active={inStage ? joinedRoom.channelId : activeId}
              unreadOf={unreadOf}
              onOpen={openConversation}
              joined={joined}
              preview={preview}
              onPreview={setPreview}
            />
          ) : (
            <HomeSidebar
              tab={tab}
              setTab={setTab}
              active={inStage ? joinedRoom.channelId : activeId}
              unreadOf={unreadOf}
              onOpen={openConversation}
              joined={joined}
              preview={preview}
              onPreview={setPreview}
              onJoin={join}
              request={request}
              onRequest={setRequest}
            />
          )}
          {joinedRoom && (
            <CallCard
              room={joinedRoom}
              onLeave={leave}
              muted={muted || deafened}
              deafened={deafened}
              sharing={sharing}
              onMute={toggleMute}
              onDeafen={toggleDeafen}
              onShare={toggleShare}
              inStage={inStage}
              ringing={ringing}
              onShowPreview={
                call?.previewHidden && hasStream && !inStage
                  ? () => patchCall({ previewHidden: false })
                  : undefined
              }
              onOpen={() => setPreview(inStage ? null : joinedRoom.channelId)}
            />
          )}
          <UserBar
            ringBg="var(--adept-ink)"
            audio={{
              muted: muted || deafened,
              deafened,
              onMute: toggleMute,
              onDeafen: toggleDeafen,
            }}
          />
        </aside>

        <main className="relative mr-2 mb-2 flex min-w-0 flex-1 overflow-hidden rounded-xl border border-white/[0.06] bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {inStage && call ? (
            <CallStage
              call={call}
              onCall={patchCall}
              room={joinedRoom}
              muted={muted || deafened}
              deafened={deafened}
              sharing={sharing}
              onMute={toggleMute}
              onDeafen={toggleDeafen}
              onShare={toggleShare}
              onLeave={leave}
              onOpenChat={() => setPreview(null)}
            />
          ) : (
            <ChatView
              key={activeId}
              conversationId={activeId}
              lane="left"
              panelInDm
              previewId={previewRoom?.channelId ?? null}
              onCall={startCall}
              onUnread={(value) => markUnread(activeId, value ? 1 : 0)}
              onCloseAside={previewRoom ? undefined : () => setPanelOpen(false)}
              floating={
                joinedRoom && call && !call.previewHidden ? (
                  <StreamPip
                    room={joinedRoom}
                    sharing={sharing}
                    onOpen={() => setPreview(joinedRoom.channelId)}
                    onHide={() => patchCall({ previewHidden: true })}
                    onStopShare={toggleShare}
                  />
                ) : null
              }
              membersOpen={panelOpen && !previewRoom}
              onToggleMembers={() => {
                setPreview(null);
                setPanelOpen((v) => !v);
              }}
              aside={
                previewRoom ? (
                  <RoomPreview
                    room={
                      joined === previewRoom.channelId
                        ? { ...previewRoom, people: [...new Set([...previewRoom.people, ME])] }
                        : previewRoom
                    }
                    muted={muted || deafened}
                    deafened={deafened}
                    sharing={sharing}
                    onShare={toggleShare}
                    onLeave={leave}
                    joined={joined === previewRoom.channelId}
                    onJoin={() => join(previewRoom.channelId)}
                    onClose={() => setPreview(null)}
                  />
                ) : panelOpen ? (
                  c.kind === "dm" ? (
                    <ProfilePanel
                      key={c.id}
                      id={c.members[0] ?? ""}
                      onCall={() => startCall(false)}
                    />
                  ) : (
                    <PeoplePanel
                      ids={c.kind === "group" ? [ME, ...c.members] : c.members}
                      server={chatServer}
                    />
                  )
                ) : null
              }
            />
          )}
        </main>
      </div>

      <JumpPalette
        open={palette}
        onOpenChange={setPalette}
        onOpen={openConversation}
        onOpenVoice={openVoice}
        onCall={c.kind === "channel" ? undefined : () => startCall(false)}
        unreadOf={unreadOf}
      />
    </div>
  );
}
