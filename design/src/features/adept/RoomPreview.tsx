import { Radio, Volume2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { type LiveRoom, server, user } from "@/mock/data";

import { ActivityLine } from "./ActivityLine";
import { SpeakingAvatar } from "./SpeakingAvatar";
import { useSpeaker } from "./useSpeaker";

export function RoomPreview({
  room,
  joined,
  onJoin,
  onClose,
}: {
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
        {server(room.serverId)?.name} · {room.people.length} talking
      </p>
      {room.live && (
        <div
          className="relative mx-4 mt-3 aspect-video overflow-hidden rounded-xl border border-white/5"
          style={{
            background:
              "radial-gradient(circle at 25% 35%, hsl(150 45% 30%), transparent 60%), radial-gradient(circle at 80% 75%, hsl(262 50% 32%), transparent 55%), var(--surface-3)",
          }}
        >
          <span className="absolute top-2 left-2 flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-white">
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
              <SpeakingAvatar id={id} size={30} speaking={speaker === id} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{u.name}</span>
                {u.activity && u.activity.kind !== "voice" && <ActivityLine a={u.activity} />}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-auto grid gap-2 p-4">
        {!joined && (
          <Button onClick={onJoin} className="h-10 w-full font-semibold">
            Join voice
          </Button>
        )}
        {room.live && (
          <Button variant="secondary" className="h-10 w-full">
            Watch {user(room.live).name}'s stream
          </Button>
        )}
      </div>
    </aside>
  );
}
