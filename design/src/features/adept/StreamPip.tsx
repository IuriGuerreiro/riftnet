import { Maximize2, Radio, Square, X } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { type LiveRoom, ME, user } from "@/mock/data";

export function StreamPip({
  room,
  sharing,
  onOpen,
  onStopShare,
}: {
  room: LiveRoom;
  sharing: boolean;
  onOpen: () => void;
  onStopShare: () => void;
}) {
  const streams = [...(sharing ? [ME] : []), ...(room.live ? [room.live] : [])];
  const [pick, setPick] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const current = streams.find((s) => s === pick) ?? streams[0];
  if (!current || hidden === streams.join()) return null;
  const mine = current === ME;
  const label = mine ? "Your screen" : `${user(current).name}'s screen`;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-3 group/pip absolute right-4 bottom-24 z-40 w-80 overflow-hidden rounded-xl bg-black shadow-2xl ring-1 shadow-black/60 ring-white/10 duration-200">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open call, ${label}`}
        className="block w-full"
      >
        <img
          src={mine ? "/media/photo-1.jpg" : "/media/photo-3.jpg"}
          alt={label}
          className="aspect-video w-full object-cover"
        />
      </button>
      <span className="pointer-events-none absolute top-2 left-2 flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-white">
        <Radio className="size-3" /> LIVE
      </span>
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover/pip:opacity-100">
        <button
          type="button"
          aria-label="Open call"
          onClick={onOpen}
          className="grid size-7 place-items-center rounded-md bg-black/60 text-white backdrop-blur hover:bg-black/80"
        >
          <Maximize2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Hide preview"
          onClick={() => setHidden(streams.join())}
          className="grid size-7 place-items-center rounded-md bg-black/60 text-white backdrop-blur hover:bg-black/80"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2 bg-surface-1 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{label}</span>
        {streams.length > 1 &&
          streams.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPick(s)}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                s === current
                  ? "bg-brand/20 text-brand"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s === ME ? "You" : user(s).name}
            </button>
          ))}
        {mine && (
          <button
            type="button"
            onClick={onStopShare}
            className="flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive hover:bg-destructive/25"
          >
            <Square className="size-2.5 fill-current" /> Stop
          </button>
        )}
      </div>
    </div>
  );
}
