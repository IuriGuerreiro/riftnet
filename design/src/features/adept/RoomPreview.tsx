import { HeadphoneOff, Mic, MicOff, MonitorUp, PhoneOff, Radio, Volume2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { type LiveRoom, ME, server, user } from "@/mock/data";

import { ActivityLine } from "./ActivityLine";
import { ScreenSharePreview } from "./ScreenSharePreview";
import { SpeakingAvatar } from "./SpeakingAvatar";
import { useSpeaker } from "./useSpeaker";

export function RoomPreview({
  room,
  joined,
  onJoin,
  onClose,
  muted,
  deafened,
  sharing,
  onShare,
  onLeave,
}: {
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  onShare: () => void;
  onLeave: () => void;
  room: LiveRoom;
  joined: boolean;
  onJoin: () => void;
  onClose: () => void;
}) {
  const speaker = useSpeaker(room.people);
  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface-1">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Volume2 className="size-4 text-success" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{room.name}</p>
        </div>
        <button
          type="button"
          aria-label="Close preview"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        {server(room.serverId)?.name} · {room.people.length} in call
      </p>
      {joined && sharing && (
        <div className="mx-4 mt-3">
          <ScreenSharePreview onStop={onShare} />
        </div>
      )}
      {room.live && (
        <div className="relative mx-4 mt-3 aspect-video overflow-hidden rounded-xl border border-white/5">
          <img src="/media/photo-3.jpg" alt="" className="size-full object-cover" />
          <span className="absolute top-2 left-2 flex items-center gap-1 rounded bg-danger-fill px-1.5 py-0.5 text-[10px] font-bold text-white">
            <Radio className="size-3" /> LIVE
          </span>
          <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] text-white/90 backdrop-blur">
            {user(room.live).name} · {user(room.live).activity?.label}
          </span>
        </div>
      )}
      <div className="mt-3 grid gap-0.5 px-2">
        {room.people.map((id) => {
          const u = user(id);
          return (
            <div key={id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
              <SpeakingAvatar
                id={id}
                size={30}
                speaking={speaker === id && !(id === ME && (muted || deafened))}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {u.name}
                  {id === ME ? " (you)" : ""}
                </span>
                {u.activity && u.activity.kind !== "voice" && <ActivityLine a={u.activity} />}
              </span>
              {id === ME && sharing && (
                <MonitorUp aria-label="Sharing screen" className="size-3.5 text-brand-text" />
              )}
              {id === ME && deafened ? (
                <HeadphoneOff aria-label="Deafened" className="size-3.5 text-destructive" />
              ) : id === ME && muted ? (
                <MicOff aria-label="Muted" className="size-3.5 text-destructive" />
              ) : (
                <Mic aria-label="Microphone on" className="size-3.5 text-muted-foreground" />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-auto grid gap-2 p-4">
        {joined && (
          <>
            <Button variant="secondary" onClick={onShare}>
              <MonitorUp className="size-4" />
              {sharing ? "Stop sharing" : "Share your screen"}
            </Button>
            <Button variant="destructive" onClick={onLeave}>
              <PhoneOff className="size-4" />
              Leave call
            </Button>
          </>
        )}
        {!joined && (
          <Button onClick={onJoin} className="h-10 w-full font-semibold">
            Join voice
          </Button>
        )}
        {room.live && (
          <Button variant="secondary" onClick={onJoin} className="h-10 w-full">
            Watch {user(room.live).name}'s stream
          </Button>
        )}
      </div>
    </aside>
  );
}
