import { Monitor, Square, Volume2 } from "lucide-react";

import { world } from "@/mock/world";

export function ScreenSharePreview({ onStop }: { onStop: () => void }) {
  return (
    <section
      aria-label="Your screen share"
      className="overflow-hidden rounded-xl border border-brand/35 bg-background"
    >
      <div className="relative aspect-video overflow-hidden bg-ink">
        <img
          src="/media/photo-1.jpg"
          alt="Screen share preview of a game"
          className="size-full object-cover"
        />
        <span className="absolute top-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
          YOUR SCREEN · PREVIEW
        </span>
        <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-1 text-[10px] text-white">
          <Volume2 className="size-3" /> {world.share.audio ? "With sound" : "No sound"}
        </span>
      </div>
      <div className="flex items-center gap-2 p-2.5">
        <Monitor className="size-4 shrink-0 text-brand-text" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">Your screen</span>
          <span className="block text-[11px] text-muted-foreground">
            {world.share.source} · {world.share.quality}
          </span>
        </span>
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop sharing your screen"
          title="Stop sharing"
          className="grid size-7 place-items-center rounded-md text-destructive hover:bg-destructive/15"
        >
          <Square className="size-3.5" />
        </button>
      </div>
    </section>
  );
}
