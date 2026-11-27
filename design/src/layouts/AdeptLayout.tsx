import { Compass, Menu, Plus, Search, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AdeptMark } from "@/components/brand/AdeptMark";
import { ServerIcon } from "@/components/ServerIcon";
import { CallCard } from "@/features/adept/CallCard";
import { IncomingCall, SharePlayBanner } from "@/features/adept/CallPrompts";
import { CallStage, type CallState } from "@/features/adept/CallStage";
import { PeoplePanel } from "@/features/adept/PeoplePanel";
import { ProfilePanel } from "@/features/adept/ProfilePanel";
import { RoomPreview } from "@/features/adept/RoomPreview";
import { StreamPip } from "@/features/adept/StreamPip";
import { TopBarStatus } from "@/features/adept/TopBarStatus";
import { ChatView } from "@/features/chat/ChatView";
import { Dialogs } from "@/features/dialogs/Dialogs";
import { EmojiText } from "@/features/emoji/EmojiText";
import { onOpenChat } from "@/features/profile/openChat";
import { JumpPalette } from "@/features/shell/JumpPalette";
import { Banners, Toasts } from "@/features/shell/Notices";
import {
  HomeSidebar,
  type HomeTab,
  mentionsIn,
  RailTile,
  ServerSidebar,
  type UnreadOf,
} from "@/features/shell/Sidebars";
import { UserBar } from "@/features/shell/UserBar";
import { cn } from "@/lib/utils";
import {
  conversation,
  CONVERSATIONS,
  type LiveRoom,
  ME,
  server as findServer,
  SERVERS,
} from "@/mock/data";
import { change, ensureDm, openDialog, systemMessage, toast, useWorld, world } from "@/mock/world";

const WIDE = "(min-width: 1100px)";

export function AdeptLayout() {
  useWorld();
  const [placeId, setPlace] = useState("home");
  const place = SERVERS.some((x) => x.id === placeId) ? placeId : "home";
  const [nav, setNav] = useState(false);
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
  const [preview, setPreview] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia(WIDE).matches);
  const [palette, setPalette] = useState(false);

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

  const asking = call?.control?.role === "viewer" && !call.control.active;
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(
      () => setCall((x) => (x?.control ? { ...x, control: { ...x.control, active: true } } : x)),
      3000,
    );
    return () => clearTimeout(timer);
  }, [asking]);

  const joined = call?.id ?? null;
  const unreadOf: UnreadOf = (id, base) => counts[id] ?? base;
  const markUnread = (id: string, n: number) => setCounts((x) => ({ ...x, [id]: n }));
  const dms = CONVERSATIONS.filter((x) => x.kind !== "channel");
  const s = SERVERS.find((x) => x.id === place);
  const activeId = openIn[place] ?? s?.channels.find((x) => x.kind === "text")?.id ?? "dm-maya";
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
  const dmMentions = dms.reduce((n, x) => n + (unreadOf(x.id, x.unread) ? x.mentions : 0), 0);

  const openConversation = (id: string) => {
    const conv = conversation(id.startsWith("dm-") ? ensureDm(id.slice(3)) : id);
    const where = conv.kind === "channel" ? (conv.serverId ?? "home") : "home";
    setPlace(where);
    setOpenIn((o) => ({ ...o, [where]: id }));
    markUnread(id, 0);
    setPreview(null);
    setPalette(false);
    setNav(false);
    if (id.startsWith("dm-") && world.empty)
      change(() => {
        world.empty = false;
      });
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
    if (call) {
      setPreview(joined);
      openDialog({
        kind: "confirm",
        title: "Switch calls?",
        body: "You'll leave your current call.",
        action: "Switch",
        run: () => {
          setPreview(id);
          begin(id, direct, camera);
        },
      });
      return;
    }
    begin(id, direct, camera);
  };
  const begin = (id: string, direct: boolean, camera: boolean) => {
    setCall({
      id,
      startedAt: Date.now(),
      camera,
      focused: null,
      ringing: direct,
      previewHidden: false,
      chat: false,
      control: null,
    });
    setSharing(false);
  };
  const join = (id: string) => connect(id, false, false);
  const startCall = (video: boolean) => connect(activeId, true, video);
  const patchCall = (patch: Partial<CallState>) => setCall((x) => x && { ...x, ...patch });
  const leave = () => {
    if (call && callConversation)
      systemMessage(
        call.id,
        call.ringing
          ? "Call cancelled."
          : `Call ended after ${Math.max(1, Math.round((Date.now() - call.startedAt) / 60000))} min.`,
      );
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
  const goLive = () => {
    setSharing(true);
    patchCall({ previewHidden: false });
  };
  const toggleShare = () => {
    if (!sharing) {
      openDialog({ kind: "share" });
      return;
    }
    setSharing(false);
    patchCall({ control: null });
  };
  const answer = (video: boolean) => {
    const who = world.ringing?.who;
    if (!who) return;
    const id = ensureDm(who);
    const take = () => {
      change(() => {
        world.ringing = null;
      });
      setSharing(false);
      openConversation(id);
      begin(id, false, video);
      setPreview(id);
    };
    if (call)
      openDialog({
        kind: "confirm",
        title: "Switch calls?",
        body: "You'll leave your current call.",
        action: "Switch",
        run: take,
      });
    else take();
  };
  const step = (by: number, unreadOnly: boolean) => {
    const list = s
      ? s.channels
          .filter((x) => x.kind === "text")
          .map((x) => ({ id: x.id, unread: unreadOf(x.id, x.unread ?? 0) }))
      : dms
          .filter((x) => !world.closed.has(x.id))
          .map((x) => ({ id: x.id, unread: unreadOf(x.id, x.unread) }));
    const at = list.findIndex((x) => x.id === activeId);
    for (let i = 1; i <= list.length; i += 1) {
      const next = list[(at + by * i + list.length * i) % list.length];
      if (next && (!unreadOnly || next.unread > 0)) {
        openConversation(next.id);
        return;
      }
    }
  };
  const shortcuts = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const run =
      mod && e.shiftKey && key === "m"
        ? toggleMute
        : mod && e.shiftKey && key === "d"
          ? toggleDeafen
          : mod && e.shiftKey && key === "f12"
            ? () => patchCall({ control: null })
            : mod && key === "k"
              ? () => setPalette((p) => !p)
              : mod && key === ","
                ? () => openDialog({ kind: "settings" })
                : mod && key === "/"
                  ? () => openDialog({ kind: "shortcuts" })
                  : e.altKey && (key === "arrowdown" || key === "arrowup")
                    ? () => step(key === "arrowdown" ? 1 : -1, e.shiftKey)
                    : null;
    if (!run) return;
    e.preventDefault();
    run();
  };
  useEffect(() => {
    onOpenChat(openConversation);
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  });

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-ink",
        world.settings.reduceMotion && "reduce-motion",
        world.settings.density === "compact" && "compact",
      )}
      style={{ zoom: world.settings.scale / 100, height: `${10000 / world.settings.scale}%` }}
    >
      <a
        href="#chat"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-brand-fill focus:p-2 focus:text-white"
      >
        Skip to chat
      </a>
      <Banners />
      <header className="grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_minmax(120px,300px)_auto] xl:grid-cols-[1fr_minmax(0,440px)_1fr] items-center gap-4 px-3">
        <div className="flex min-w-0 items-center gap-2.5 text-sm">
          <button
            type="button"
            aria-label="Toggle sidebar"
            aria-expanded={nav}
            onClick={() => setNav(!nav)}
            className="grid size-7 shrink-0 place-items-center rounded-lg hover:bg-surface-2 md:hidden"
          >
            <Menu className="size-4" />
          </button>
          <AdeptMark className="size-5 shrink-0" />
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
                text={
                  inStage
                    ? joinedRoom.name
                    : world.empty && place === "home"
                      ? "Welcome"
                      : c.kind === "channel"
                        ? `# ${c.title}`
                        : c.title
                }
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
          onLive={() => {
            go("home");
            setTab("chats");
          }}
        />
      </header>

      <div className="relative flex min-h-0 flex-1">
        <nav
          aria-label="Servers"
          className="flex w-[60px] shrink-0 flex-col items-center gap-3 overflow-y-auto pt-1 pb-3"
        >
          <RailTile
            label="Home"
            active={place === "home"}
            mentions={dmMentions}
            onClick={() => {
              go("home");
              setNav(true);
            }}
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
          {(world.empty ? [] : SERVERS).map((srv) => (
            <RailTile
              key={srv.id}
              label={srv.name}
              active={place === srv.id}
              unread={
                !world.muted.has(srv.id) &&
                srv.channels.some((x) => unreadOf(x.id, x.unread ?? 0) > 0)
              }
              mentions={mentionsIn(srv, unreadOf)}
              voice={srv.channels.some((x) => (x.voice?.length ?? 0) > 0)}
              onClick={() => {
                go(srv.id);
                setNav(true);
              }}
            >
              <ServerIcon server={srv} size={40} active={place === srv.id} />
            </RailTile>
          ))}
          <div className="mt-auto flex flex-col items-center gap-2 pt-3">
            <button
              type="button"
              aria-label="Add a server"
              onClick={() => openDialog({ kind: "addServer" })}
              title="Add a server"
              className="grid size-10 place-items-center rounded-[35%] bg-surface-1 text-muted-foreground ring-1 ring-white/[0.06] transition-all ring-inset hover:rounded-[28%] hover:bg-surface-2 hover:text-foreground"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Explore"
              onClick={() => openDialog({ kind: "discover" })}
              title="Explore"
              className="grid size-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Compass className="size-[18px]" />
            </button>
          </div>
        </nav>

        <aside
          aria-label="Chats"
          className={cn(
            "flex w-[248px] shrink-0 flex-col bg-ink max-md:absolute max-md:inset-y-0 max-md:left-[60px] max-md:z-40 max-md:shadow-2xl",
            !nav && "max-md:hidden",
          )}
        >
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
              onRead={(id) => markUnread(id, 0)}
            />
          )}
          <div className="mx-2 mb-2 overflow-hidden rounded-xl bg-surface-1 ring-1 ring-white/[0.06] ring-inset">
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
              embedded
              audio={{
                muted: muted || deafened,
                deafened,
                onMute: toggleMute,
                onDeafen: toggleDeafen,
              }}
            />
          </div>
        </aside>

        <main
          id="chat"
          tabIndex={-1}
          className="relative outline-none mr-2 mb-2 flex min-w-0 flex-1 overflow-hidden rounded-xl border border-white/[0.06] bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          {s?.denied ? (
            <div className="m-auto max-w-sm p-8 text-center">
              <h2 className="text-lg font-semibold">You can&apos;t open {s.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                You were removed, or the server no longer exists.
              </p>
            </div>
          ) : world.empty && place === "home" ? (
            <div className="m-auto max-w-sm p-8 text-center">
              <h2 className="text-lg font-semibold">Welcome to Adept</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Add a friend or make a server to start talking.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTab("friends");
                    setNav(true);
                  }}
                  className="h-9 rounded-lg bg-brand-fill px-4 text-sm font-semibold text-white"
                >
                  Add a friend
                </button>
                <button
                  type="button"
                  onClick={() => openDialog({ kind: "addServer" })}
                  className="h-9 rounded-lg bg-surface-3 px-4 text-sm font-medium"
                >
                  Add a server
                </button>
              </div>
            </div>
          ) : inStage && call ? (
            <>
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
                onOpenChat={() => {
                  if (window.matchMedia(WIDE).matches) patchCall({ chat: !call.chat });
                  else setPreview(null);
                }}
              />
              {call.chat && (
                <div className="flex w-[380px] shrink-0 border-l border-border max-lg:hidden">
                  <ChatView key={activeId} conversationId={activeId} />
                </div>
              )}
            </>
          ) : (
            <ChatView
              key={activeId}
              conversationId={activeId}
              lane="full"
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

      <Dialogs onShare={goLive} />
      <Toasts />
      <IncomingCall onAnswer={answer} />
      <SharePlayBanner
        control={call?.control ?? null}
        onStop={() => {
          patchCall({ control: null });
          toast("Share Play stopped");
        }}
        onGrant={(who) => patchCall({ control: { who, role: "host", active: true } })}
      />
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
