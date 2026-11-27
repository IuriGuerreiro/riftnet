import { Download, RotateCw, WifiOff, X } from "lucide-react";

import { Avatar } from "@/components/Avatar";
import { openChat } from "@/features/profile/openChat";
import { change, dismissToast, useWorld, world } from "@/mock/world";

export function Banners() {
  useWorld();
  const bar = "flex h-9 shrink-0 items-center justify-center gap-3 px-4 text-xs font-medium";
  return (
    <div role="status">
      {world.connection !== "online" && (
        <div className={`${bar} bg-warning text-ink`}>
          <WifiOff className="size-4" />
          {world.connection === "offline"
            ? "You're offline. Messages send when you reconnect."
            : "Connection lost. Reconnecting…"}
          <button
            type="button"
            className="rounded-md bg-ink/15 px-2 py-1 font-semibold"
            onClick={() =>
              change(() => {
                world.connection = "online";
              })
            }
          >
            Reconnect
          </button>
        </div>
      )}
      {world.update && (
        <div className={`${bar} bg-brand-fill text-white`}>
          <Download className="size-4" />
          {world.update === "available"
            ? "Adept 0.2.0 is available."
            : world.update === "downloading"
              ? "Downloading the update…"
              : "Update ready."}
          {world.update !== "downloading" && (
            <button
              type="button"
              className="flex items-center gap-1 rounded-md bg-white/20 px-2 py-1 font-semibold"
              onClick={() => {
                if (world.update === "ready") {
                  change(() => {
                    world.update = null;
                  });
                  return;
                }
                change(() => {
                  world.update = "downloading";
                });
                setTimeout(
                  () =>
                    change(() => {
                      world.update = "ready";
                    }),
                  2500,
                );
              }}
            >
              {world.update === "ready" && <RotateCw className="size-3" />}
              {world.update === "ready" ? "Restart" : "Update"}
            </button>
          )}
          <button
            type="button"
            aria-label="Later"
            onClick={() =>
              change(() => {
                world.update = null;
              })
            }
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export function Toasts() {
  useWorld();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed top-14 right-4 z-[60] grid w-72 max-w-[calc(100vw-2rem)] gap-2"
    >
      {world.toasts.map((t) => (
        <div
          key={t.id}
          className="animate-in fade-in slide-in-from-right-4 pointer-events-auto flex items-center gap-2.5 rounded-xl border border-border bg-popover p-3 text-sm shadow-2xl"
        >
          {t.who && <Avatar id={t.who} size={28} />}
          <button
            type="button"
            disabled={!t.open}
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              if (t.open) openChat(t.open);
              dismissToast(t.id);
            }}
          >
            {t.text}
          </button>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>
      ))}
    </div>
  );
}
