import { Gamepad2, Headphones, MonitorPlay, Radio, Search, Volume2 } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarStack } from "@/components/Avatar";
import { Lockup } from "@/components/brand/Lockup";
import { ChatView } from "@/features/chat/ChatView";
import { ConversationRow } from "@/features/shell/ConversationRow";
import { MemberList } from "@/features/shell/MemberList";
import { UserBar } from "@/features/shell/UserBar";
import { VoiceDock } from "@/features/shell/VoiceDock";
import { cn } from "@/lib/utils";
import {
  type Activity,
  conversation,
  CONVERSATIONS,
  FRIENDS,
  LIVE_ROOMS,
  type LiveRoom,
  ME,
  server,
  user,
} from "@/mock/data";

const ACTIVITY_ICON: Record<Activity["kind"], typeof Gamepad2> = {
  playing: Gamepad2,
  listening: Headphones,
  streaming: MonitorPlay,
  voice: Volume2,
};

function RoomCard({
  room,
  joined,
  onJoin,
}: {
  room: LiveRoom;
  joined: boolean;
  onJoin: () => void;
}) {
  const people = joined ? [...room.people, ME] : room.people;
  const names = people.map((id) => user(id).name);
  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-colors",
        joined ? "border-success/40 bg-success/[0.06]" : "border-border bg-surface-2",
      )}
    >
      <div className="flex items-center gap-2">
        <Volume2 className={cn("size-4", joined ? "text-success" : "text-muted-foreground")} />
        <span className="truncate text-sm font-semibold">{room.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          · {server(room.serverId)?.name}
        </span>
      </div>
      {room.live && (
        <div
          className="relative mt-2.5 aspect-video overflow-hidden rounded-lg border border-white/5"
          style={{
            background:
              "radial-gradient(circle at 25% 35%, hsl(150 45% 30%), transparent 60%), radial-gradient(circle at 80% 75%, hsl(262 50% 32%), transparent 55%), var(--surface-3)",
          }}
        >
          <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-danger-fill px-1.5 py-0.5 text-[10px] font-bold text-white">
            <Radio className="size-3" /> LIVE
          </span>
          <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] text-white/90 backdrop-blur">
            <Avatar id={room.live} size={14} />
            {user(room.live).name} · {user(room.live).activity?.label}
          </span>
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <AvatarStack
          ids={people}
          size={24}
          ringBg={joined ? "var(--surface-2)" : "var(--surface-2)"}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {names.join(", ")}
        </span>
        {!joined && (
          <button
            type="button"
            onClick={onJoin}
            className="h-7 rounded-md bg-brand-fill px-3 text-xs font-semibold text-white hover:bg-brand-fill/85"
          >
            Join
          </button>
        )}
      </div>
    </div>
  );
}

function FriendRow({ id, onOpen }: { id: string; onOpen: () => void }) {
  const u = user(id);
  const Icon = u.activity ? ACTIVITY_ICON[u.activity.kind] : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent/60"
    >
      <Avatar id={id} size={32} status ringBg="var(--surface-1)" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{u.name}</span>
        {u.activity && Icon && (
          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <Icon className="size-3 shrink-0" />
            <span className="truncate">
              {u.activity.label}
              {u.activity.since
                ? ` · ${u.activity.since}`
                : u.activity.detail
                  ? ` · ${u.activity.detail}`
                  : ""}
            </span>
          </span>
        )}
      </span>
    </button>
  );
}

export function LiveLayout() {
  const [active, setActive] = useState("owls-general");
  const [joined, setJoined] = useState<string | null>("owls-squad");
  const [membersOpen, setMembersOpen] = useState(false);
  const c = conversation(active);
  const room = LIVE_ROOMS.find((r) => r.channelId === joined);
  const active_friends = FRIENDS.filter(
    (f) => f.status !== "offline" && f.activity && f.activity.kind !== "voice",
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[320px] shrink-0 flex-col border-r border-border bg-surface-1">
          <div className="flex h-14 shrink-0 items-center justify-between px-4">
            <Lockup />
            <button
              type="button"
              aria-label="Search"
              className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Search className="size-[18px]" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <p className="flex items-center gap-2 px-1 pt-1 pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              Live now
            </p>
            <div className="grid gap-2">
              {LIVE_ROOMS.map((r) => (
                <RoomCard
                  key={r.channelId}
                  room={r}
                  joined={joined === r.channelId}
                  onJoin={() => setJoined(r.channelId)}
                />
              ))}
            </div>

            <p className="px-1 pt-5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              Friends doing stuff
            </p>
            {active_friends.map((f) => (
              <FriendRow key={f.id} id={f.id} onOpen={() => setActive(`dm-${f.id}`)} />
            ))}

            <p className="px-1 pt-5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              Chats
            </p>
            {[...CONVERSATIONS]
              .sort((a, b) => a.rank - b.rank)
              .map((x) => (
                <ConversationRow
                  key={x.id}
                  c={x}
                  dense
                  active={active === x.id}
                  onClick={() => setActive(x.id)}
                />
              ))}
          </div>
          <UserBar />
        </aside>
        <ChatView
          key={active}
          conversationId={active}
          membersOpen={membersOpen}
          onToggleMembers={() => setMembersOpen((v) => !v)}
        />
        {membersOpen && c.kind !== "dm" && <MemberList ids={c.members} />}
      </div>
      {room && (
        <VoiceDock
          room={{ ...room, people: [...room.people, ME] }}
          onLeave={() => setJoined(null)}
        />
      )}
    </div>
  );
}
