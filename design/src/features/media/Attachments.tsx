import { Download, FileArchive, FileText, Film, ImageIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { Attachment } from "@/mock/data";

import { formatBytes } from "./format";
import { Lightbox, type Viewable } from "./Lightbox";
import { VideoPlayer } from "./VideoPlayer";

const MAX_W = 440;
const MAX_H = 340;

function fit(w: number, h: number, maxW = MAX_W, maxH = MAX_H) {
  const s = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

function Tile({
  item,
  onOpen,
  className,
  style,
  more,
}: {
  item: Viewable;
  onOpen: () => void;
  className?: string;
  style?: React.CSSProperties;
  more?: number;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${item.name}`}
      style={style}
      className={cn("group/tile relative overflow-hidden bg-surface-2", className)}
    >
      <img
        src={item.url}
        alt={item.name}
        loading="lazy"
        draggable={false}
        className="size-full object-cover transition-[transform,filter] duration-300 group-hover/tile:scale-[1.03] group-hover/tile:brightness-110"
      />
      {item.kind === "gif" && (
        <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white backdrop-blur">
          GIF
        </span>
      )}
      {more ? (
        <span className="absolute inset-0 grid place-items-center bg-black/55 text-2xl font-semibold text-white">
          +{more}
        </span>
      ) : null}
    </button>
  );
}

function Gallery({ items, onOpen }: { items: Viewable[]; onOpen: (i: number) => void }) {
  const n = items.length;
  const first = items[0];
  if (!first) return null;

  if (n === 1) {
    const size = first.kind === "gif" ? fit(first.w, first.h, 320, 320) : fit(first.w, first.h);
    return (
      <Tile
        item={first}
        onOpen={() => onOpen(0)}
        className="max-w-full rounded-xl border border-white/5"
        style={size}
      />
    );
  }

  const shown = items.slice(0, 5);
  const extra = n - shown.length;
  const layouts: Record<number, string[]> = {
    2: ["col-span-3 row-span-2", "col-span-3 row-span-2"],
    3: ["col-span-4 row-span-2", "col-span-2", "col-span-2"],
    4: ["col-span-3", "col-span-3", "col-span-3", "col-span-3"],
    5: ["col-span-3", "col-span-3", "col-span-2", "col-span-2", "col-span-2"],
  };
  const spans = layouts[shown.length] ?? [];

  return (
    <div className="grid w-[440px] max-w-full auto-rows-[130px] grid-cols-6 gap-1 overflow-hidden rounded-xl">
      {shown.map((it, i) => (
        <Tile
          key={`${it.url}-${i}`}
          item={it}
          onOpen={() => onOpen(i)}
          className={spans[i]}
          more={i === shown.length - 1 && extra > 0 ? extra : undefined}
        />
      ))}
    </div>
  );
}

function FileIcon({ name }: { name: string }) {
  if (/\.(zip|rar|7z)$/i.test(name)) return <FileArchive className="size-5" />;
  if (/\.(mp4|mov|webm)$/i.test(name)) return <Film className="size-5" />;
  if (/\.(png|jpe?g|webp)$/i.test(name)) return <ImageIcon className="size-5" />;
  return <FileText className="size-5" />;
}

export function FileCard({ name, size, url }: { name: string; size: number; url?: string }) {
  return (
    <div className="flex w-[360px] max-w-full items-center gap-3 rounded-xl border border-border bg-surface-1 p-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand-text">
        <FileIcon name={name} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-brand-text hover:underline">{name}</p>
        <p className="text-xs text-muted-foreground">{formatBytes(size)}</p>
      </div>
      <a
        href={url ?? "#"}
        download={name}
        aria-label={`Download ${name}`}
        className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Download className="size-4" />
      </a>
    </div>
  );
}

export function Attachments({
  items,
  author,
  time,
}: {
  items: Attachment[];
  author: string;
  time: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const viewable = items.filter((a): a is Viewable => a.kind === "image" || a.kind === "gif");

  return (
    <div className="mt-2 flex flex-col items-start gap-2">
      {viewable.length > 0 && <Gallery items={viewable} onOpen={setOpen} />}
      {items.map((a, i) =>
        a.kind === "video" ? (
          <VideoPlayer
            key={`${a.url}-${i}`}
            url={a.url}
            name={a.name}
            size={a.size}
            w={a.w}
            h={a.h}
          />
        ) : a.kind === "file" ? (
          <FileCard key={`${a.name}-${i}`} name={a.name} size={a.size} url={a.url} />
        ) : null,
      )}
      {open !== null && (
        <Lightbox
          items={viewable}
          start={open}
          author={author}
          time={time}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
