import { FileText, Film, X } from "lucide-react";

import { MediaImage } from "@/features/media/MediaImage";
import type { Attachment } from "@/mock/data";

import { formatBytes } from "./format";

export interface Staged {
  id: string;
  att: Attachment;
  progress?: number;
  error?: string;
}

export function StagedTray({
  items,
  onRemove,
  onRetry,
}: {
  items: Staged[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-border p-2.5 pb-3">
      {items.map(({ id, att, progress, error }) => (
        <div
          key={id}
          className="animate-in fade-in zoom-in-95 group/staged relative w-28 shrink-0 duration-150"
        >
          <div className="relative grid h-24 place-items-center overflow-hidden rounded-lg border border-border bg-surface-3">
            {att.kind === "image" || att.kind === "gif" ? (
              <MediaImage src={att.url} alt={att.name} className="size-full object-cover" />
            ) : att.kind === "video" ? (
              <>
                <video src={att.url} muted preload="metadata" className="size-full object-cover" />
                <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded bg-black/60 text-white">
                  <Film className="size-3" />
                </span>
              </>
            ) : (
              <FileText className="size-8 text-brand-text" />
            )}
            {att.kind === "gif" && (
              <span className="absolute top-1 left-1 rounded bg-black/60 px-1 text-[9px] font-bold text-white">
                GIF
              </span>
            )}
          </div>
          {progress !== undefined && progress < 100 && !error && (
            <div
              role="progressbar"
              aria-label={`Uploading ${att.name}`}
              aria-valuenow={progress}
              className="mt-1 h-1 overflow-hidden rounded-full bg-surface-4"
            >
              <div
                className="h-full bg-brand transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {error && (
            <button
              type="button"
              disabled={error.startsWith("Over")}
              onClick={() => onRetry(id)}
              className="mt-1 text-[11px] font-medium text-destructive enabled:hover:underline"
            >
              {error}
              {error.startsWith("Over") ? "" : " · Retry"}
            </button>
          )}
          <p className="mt-1 truncate text-[11px] text-foreground/80">{att.name}</p>
          {"size" in att && (
            <p className="text-[10px] text-muted-foreground">{formatBytes(att.size)}</p>
          )}
          <button
            type="button"
            aria-label={`Remove ${att.name}`}
            onClick={() => onRemove(id)}
            className="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow transition-colors hover:bg-danger-fill hover:text-white"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
