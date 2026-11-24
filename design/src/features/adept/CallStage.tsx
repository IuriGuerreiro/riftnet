import {
  HeadphoneOff,
  Headphones,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Radio,
  Square,
  Users,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { type LiveRoom, ME, server, user } from "@/mock/data";

import { useSpeaker } from "./useSpeaker";

type Tile = { kind: "person"; id: string } | { kind: "screen"; id: string };

const tileKey = (t: Tile) => `${t.kind}:${t.id}`;

function useElapsed() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((now - start) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PersonTile({
  id,
  speaking,
  muted,
  camera,
  small,
  onFocus,
}: {
  id: string;
  speaking: boolean;
  muted: boolean;
  camera: boolean;
  small?: boolean;
  onFocus: () => void;
}) {
  const u = user(id);
  return (
    <button
      type="button"
      onClick={onFocus}
      className={cn(
        "group/tile relative aspect-video w-full overflow-hidden rounded-2xl text-left transition-shadow duration-150",
        speaking
          ? "ring-2 ring-success shadow-[0_0_24px_-4px_var(--success)]"
          : "ring-1 ring-white/5",
      )}
      style={{
        background: `radial-gradient(circle at 50% 45%, hsl(${u.hue} 40% 26%), hsl(${u.hue} 30% 11%) 75%)`,
      }}
    >
      {camera ? (
        <img src="/media/photo-5.jpg" alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-0 grid place-items-center">
          <span
            className={cn(
              "rounded-full transition-transform duration-200",
              speaking && "scale-105",
            )}
          >
            <Avatar id={id} size={small ? 44 : 80} />
          </span>
        </span>
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1.5 rounded-lg bg-black/55 px-2 py-1 text-xs font-medium text-white backdrop-blur">
        {muted && <MicOff className="size-3 text-destructive" />}
        <span className="truncate">
          {u.name}
          {id === ME ? " (you)" : ""}
        </span>
      </span>
    </button>
  );
}

function ScreenTile({
  id,
  mine,
  small,
  onFocus,
  onStop,
}: {
  id: string;
  mine: boolean;
  small?: boolean;
  onFocus: () => void;
  onStop: () => void;
}) {
  const label = mine ? "Your screen" : `${user(id).name}'s screen`;
  return (
    <div
      className={cn(
        "group/screen relative w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10",
        small ? "aspect-video" : "h-full",
      )}
    >
      <button
        type="button"
        onClick={onFocus}
        className="absolute inset-0"
        aria-label={`Focus ${label}`}
      >
        <img
          src={mine ? "/media/photo-1.jpg" : "/media/photo-3.jpg"}
          alt={label}
          className="size-full object-contain"
        />
      </button>
      <span className="pointer-events-none absolute top-2 left-2 flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-white">
        <Radio className="size-3" /> LIVE
      </span>
      <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur">
        <MonitorUp className="size-3.5" />
        {label}
      </span>
      {!small && (
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 transition-opacity group-hover/screen:opacity-100">
          {mine && (
            <button
              type="button"
              onClick={onStop}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-destructive px-3 text-xs font-semibold text-white hover:bg-destructive/85"
            >
              <Square className="size-3 fill-current" /> Stop sharing
            </button>
          )}
          <button
            type="button"
            aria-label="Fullscreen"
            className="grid size-8 place-items-center rounded-lg bg-black/60 text-white backdrop-blur hover:bg-black/80"
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function ControlButton({
  label,
  active,
  danger,
  wide,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  wide?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid h-12 place-items-center rounded-2xl transition-all duration-150 active:scale-95",
        wide ? "w-16" : "w-12",
        danger
          ? "bg-destructive text-white hover:bg-destructive/85"
          : active
            ? "bg-white text-ink hover:bg-white/90"
            : "bg-white/10 text-white hover:bg-white/20",
      )}
    >
      {children}
    </button>
  );
}

export function CallStage({
  room,
  muted,
  deafened,
  sharing,
  onMute,
  onDeafen,
  onShare,
  onLeave,
  onOpenChat,
}: {
  room: LiveRoom;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  onMute: () => void;
  onDeafen: () => void;
  onShare: () => void;
  onLeave: () => void;
  onOpenChat: () => void;
}) {
  const elapsed = useElapsed();
  const [camera, setCamera] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const speaker = useSpeaker(room.people);

  const screens: Tile[] = [
    ...(sharing ? [{ kind: "screen" as const, id: ME }] : []),
    ...(room.live ? [{ kind: "screen" as const, id: room.live }] : []),
  ];
  const people: Tile[] = room.people.map((id) => ({ kind: "person", id }));
  const tiles = [...screens, ...people];
  const focus = tiles.find((t) => tileKey(t) === focused) ?? screens[0];
  const rest = focus ? tiles.filter((t) => tileKey(t) !== tileKey(focus)) : tiles;

  const render = (t: Tile, small?: boolean) =>
    t.kind === "screen" ? (
      <ScreenTile
        key={tileKey(t)}
        id={t.id}
        mine={t.id === ME}
        small={small}
        onFocus={() => setFocused(tileKey(t))}
        onStop={onShare}
      />
    ) : (
      <PersonTile
        key={tileKey(t)}
        id={t.id}
        small={small}
        camera={t.id === ME && camera}
        muted={t.id === ME && (muted || deafened)}
        speaking={speaker === t.id && !(t.id === ME && (muted || deafened))}
        onFocus={() => setFocused(tileKey(t))}
      />
    );

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-ink">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
        <span className="grid size-8 place-items-center rounded-lg bg-success/15 text-success">
          <Volume2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] leading-tight font-semibold">{room.name}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {server(room.serverId)?.name} · <span className="text-success">Voice connected</span> ·{" "}
            <span className="tabular-nums">{elapsed}</span>
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-xs text-muted-foreground">
          <Users className="size-3.5" /> {room.people.length}
        </span>
        <button
          type="button"
          onClick={onOpenChat}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-white/5 px-3 text-xs font-medium text-foreground hover:bg-white/10"
        >
          <MessageSquare className="size-3.5" /> Open chat
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-2">
        {focus ? (
          <div className="flex h-full flex-col gap-3">
            <div className="min-h-0 flex-1">{render(focus)}</div>
            {rest.length > 0 && (
              <div className="grid shrink-0 grid-cols-[repeat(auto-fill,minmax(160px,200px))] justify-center gap-3">
                {rest.map((t) => render(t, true))}
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto grid h-full max-w-5xl content-center gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            {tiles.map((t) => render(t))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 justify-center pt-2 pb-4">
        <div className="flex items-center gap-2 rounded-3xl border border-white/10 bg-surface-1/85 p-2 shadow-2xl shadow-black/50 backdrop-blur-md">
          <ControlButton label={muted ? "Unmute" : "Mute"} active={muted} onClick={onMute}>
            {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </ControlButton>
          <ControlButton
            label={deafened ? "Undeafen" : "Deafen"}
            active={deafened}
            onClick={onDeafen}
          >
            {deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
          </ControlButton>
          <ControlButton
            label={camera ? "Turn camera off" : "Turn camera on"}
            active={camera}
            onClick={() => setCamera((v) => !v)}
          >
            {camera ? <Video className="size-5" /> : <VideoOff className="size-5" />}
          </ControlButton>
          <ControlButton
            label={sharing ? "Stop sharing" : "Share screen"}
            active={sharing}
            onClick={onShare}
          >
            <MonitorUp className="size-5" />
          </ControlButton>
          <span className="mx-1 h-8 w-px bg-white/10" />
          <ControlButton label="Leave call" danger wide onClick={onLeave}>
            <PhoneOff className="size-5" />
          </ControlButton>
        </div>
      </div>
    </section>
  );
}
