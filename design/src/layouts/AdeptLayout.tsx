import { ChevronDown, Compass, Hash, Inbox, Pin, Plus, Radio, Search, Volume2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Avatar, AvatarStack } from "@/components/Avatar";
import { AdeptMark } from "@/components/brand/AdeptMark";
import { ServerIcon } from "@/components/ServerIcon";
import { ActivityLine } from "@/features/adept/ActivityLine";
import { CallCard } from "@/features/adept/CallCard";
import { PeoplePanel } from "@/features/adept/PeoplePanel";
import { ProfilePanel } from "@/features/adept/ProfilePanel";
import { RoomPreview } from "@/features/adept/RoomPreview";
import { TopBarStatus } from "@/features/adept/TopBarStatus";
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

const DMS = CONVERSATIONS.filter((c) => c.kind !== "channel");

function mentionsIn(s: Server) {
  return s.channels.reduce((n, c) => n + (c.mentions ?? 0), 0);
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
    <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-white">
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
          <span className="absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-ink bg-destructive px-1 text-[10px] font-bold text-white">
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
              <span className="flex shrink-0 items-center gap-0.5 rounded bg-destructive px-1 text-[9px] font-bold text-white">
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

function DmRow({ c, active, onClick }: { c: Conversation; active: boolean; onClick: () => void }) {
  const u = user(c.members[0] ?? "");
  const unread = c.unread > 0 && !active;
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
      {c.mentions > 0 && !active ? (
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
}: {
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
  const friends = [...FRIENDS].sort(
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
              <DmRow key={c.id} c={c} active={active === c.id} onClick={() => onOpen(c.id)} />
            ))}
            <SectionLabel
              action={<Plus className="size-3.5 cursor-pointer hover:text-foreground" />}
            >
              Direct messages
            </SectionLabel>
            {rest.map((c) => (
              <DmRow key={c.id} c={c} active={active === c.id} onClick={() => onOpen(c.id)} />
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
        {tab === "requests" && (
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
}: {
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
                  const unread = (c.unread ?? 0) > 0 && !isActive;
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
                        {c.mentions && !isActive ? (
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
                            <span className="rounded bg-destructive px-1 text-[9px] font-bold text-white">
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
  const [joined, setJoined] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
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
  const joinedRoom = rooms.find((r) => r.channelId === joined);
  const previewRoom = rooms.find((r) => r.channelId === preview);
  const dmMentions = DMS.reduce((n, x) => n + x.mentions, 0);

  const openConversation = (id: string) => {
    const conv = conversation(id);
    const where = conv.kind === "channel" ? (conv.serverId ?? "home") : "home";
    setPlace(where);
    setOpenIn((o) => ({ ...o, [where]: id }));
    setPreview(null);
    setPalette(false);
  };
  const join = (id: string) => {
    setJoined(id);
    setSharing(false);
    setPreview(id);
  };
  const leave = () => {
    setJoined(null);
    setSharing(false);
  };
  const toggleMute = () => {
    if (deafened) {
      setDeafened(false);
      setMuted(false);
    } else setMuted((value) => !value);
  };
  const toggleDeafen = () => setDeafened((value) => !value);
  const toggleShare = () => setSharing((value) => !value);

  return (
    <div className="flex h-full flex-col bg-ink">
      <header className="grid h-11 shrink-0 grid-cols-[1fr_minmax(0,440px)_1fr] items-center gap-4 px-3">
        <div className="flex min-w-0 items-center gap-2.5 text-sm">
          <AdeptMark className="size-5" />
          <span className="truncate text-muted-foreground">
            {chatServer ? chatServer.name : "Home"}
            <span className="px-1.5 text-surface-4">/</span>
            <span className="font-medium text-foreground">
              <EmojiText text={c.kind === "channel" ? `# ${c.title}` : c.title} size={15} />
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="flex h-7 items-center gap-2 rounded-lg border border-white/[0.06] bg-surface-1 px-3 text-xs text-muted-foreground transition-colors hover:border-white/10 hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Jump to a chat, channel or person</span>
          <kbd className="rounded bg-surface-3 px-1.5 text-[10px]">Ctrl K</kbd>
        </button>
        <TopBarStatus
          onOpen={openConversation}
          onFriends={() => {
            setPlace("home");
            setTab("friends");
          }}
          onLive={() => {
            setPlace("home");
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
            onClick={() => setPlace("home")}
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
              unread={srv.channels.some((x) => (x.unread ?? 0) > 0)}
              mentions={mentionsIn(srv)}
              voice={srv.channels.some((x) => (x.voice?.length ?? 0) > 0)}
              onClick={() => setPlace(srv.id)}
            >
              <ServerIcon server={srv} size={40} className="rounded-xl" />
            </RailTile>
          ))}
          <div className="mt-auto flex flex-col items-center gap-2 pt-3">
            <button
              type="button"
              aria-label="Add a server"
              title="Add a server"
              className="grid size-10 place-items-center rounded-xl border border-dashed border-surface-4 text-muted-foreground transition-colors hover:border-brand hover:text-brand"
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
              active={activeId}
              onOpen={openConversation}
              joined={joined}
              preview={preview}
              onPreview={setPreview}
            />
          ) : (
            <HomeSidebar
              tab={tab}
              setTab={setTab}
              active={activeId}
              onOpen={openConversation}
              joined={joined}
              preview={preview}
              onPreview={setPreview}
              onJoin={join}
            />
          )}
          {joinedRoom && (
            <CallCard
              room={{ ...joinedRoom, people: [...new Set([...joinedRoom.people, ME])] }}
              onLeave={leave}
              muted={muted || deafened}
              deafened={deafened}
              sharing={sharing}
              onMute={toggleMute}
              onDeafen={toggleDeafen}
              onShare={toggleShare}
              onOpen={() => setPreview(joinedRoom.channelId)}
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

        <main className="mr-2 mb-2 flex min-w-0 flex-1 overflow-hidden rounded-xl border border-white/[0.06] bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <ChatView
            key={activeId}
            conversationId={activeId}
            lane="left"
            panelInDm
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
                  <ProfilePanel id={c.members[0] ?? ""} />
                ) : (
                  <PeoplePanel
                    ids={c.kind === "group" ? [ME, ...c.members] : c.members}
                    server={chatServer}
                  />
                )
              ) : null
            }
          />
        </main>
      </div>

      <JumpPalette open={palette} onOpenChange={setPalette} onOpen={openConversation} />
    </div>
  );
}
