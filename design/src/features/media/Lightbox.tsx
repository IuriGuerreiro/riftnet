import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { type Attachment, user } from "@/mock/data";

import { formatBytes } from "./format";

export type Viewable = Extract<Attachment, { kind: "image" | "gif" }>;

function TopButton({
  label,
  onClick,
  href,
  download,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  download?: string;
  children: React.ReactNode;
}) {
  const cls =
    "grid size-9 place-items-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white";
  if (href) {
    return (
      <a
        href={href}
        download={download}
        target={download ? undefined : "_blank"}
        rel="noreferrer"
        aria-label={label}
        title={label}
        className={cls}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

export function Lightbox({
  items,
  start,
  author,
  time,
  onClose,
}: {
  items: Viewable[];
  start: number;
  author: string;
  time: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const item = items[index];
  const many = items.length > 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && many) {
        setZoom(null);
        setIndex((i) => (i + 1) % items.length);
      }
      if (e.key === "ArrowLeft" && many) {
        setZoom(null);
        setIndex((i) => (i - 1 + items.length) % items.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, many]);

  if (!item) return null;
  const go = (d: number) => {
    setZoom(null);
    setIndex((i) => (i + d + items.length) % items.length);
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="outline-none animate-in fade-in fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-sm duration-150"
          onClick={onClose}
        >
          <Dialog.Title className="sr-only">{item.name}</Dialog.Title>
          <div
            className="flex h-14 shrink-0 items-center gap-3 px-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Avatar id={author} size={32} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{user(author).name}</p>
              <p className="truncate text-xs text-white/55">
                {time} · {item.name}
                {item.kind === "image"
                  ? ` · ${item.w}×${item.h} · ${formatBytes(item.size)}`
                  : " · GIF"}
              </p>
            </div>
            {many && (
              <span className="mx-auto rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/80 tabular-nums">
                {index + 1} / {items.length}
              </span>
            )}
            <div className={cn("flex items-center gap-1", !many && "ml-auto")}>
              <TopButton
                label={zoom ? "Zoom out" : "Zoom in"}
                onClick={() => setZoom(zoom ? null : { x: 50, y: 50 })}
              >
                {zoom ? <ZoomOut className="size-[18px]" /> : <ZoomIn className="size-[18px]" />}
              </TopButton>
              {!item.url.startsWith("blob:") && (
                <TopButton label="Open original" href={item.url}>
                  <ExternalLink className="size-[18px]" />
                </TopButton>
              )}
              <TopButton label="Download" href={item.url} download={item.name}>
                <Download className="size-[18px]" />
              </TopButton>
              <span className="mx-1 h-5 w-px bg-white/15" />
              <TopButton label="Close" onClick={onClose}>
                <X className="size-5" />
              </TopButton>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-16">
            <img
              key={`${item.url}-${index}`}
              src={item.url}
              alt={item.name}
              draggable={false}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setZoom(
                  zoom
                    ? null
                    : {
                        x: ((e.clientX - r.left) / r.width) * 100,
                        y: ((e.clientY - r.top) / r.height) * 100,
                      },
                );
              }}
              onMouseMove={(e) => {
                if (!zoom) return;
                const r = e.currentTarget.getBoundingClientRect();
                setZoom({
                  x: ((e.clientX - r.left) / r.width) * 100,
                  y: ((e.clientY - r.top) / r.height) * 100,
                });
              }}
              className={cn(
                "animate-in zoom-in-95 fade-in max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-200",
                zoom ? "cursor-zoom-out" : "cursor-zoom-in",
              )}
              style={{
                transform: zoom ? "scale(2.2)" : undefined,
                transformOrigin: zoom ? `${zoom.x}% ${zoom.y}%` : undefined,
                imageRendering: item.kind === "gif" ? "auto" : undefined,
              }}
            />
            {many && (
              <>
                <button
                  type="button"
                  aria-label="Previous"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(-1);
                  }}
                  className="absolute left-4 grid size-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                >
                  <ChevronLeft className="size-6" />
                </button>
                <button
                  type="button"
                  aria-label="Next"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(1);
                  }}
                  className="absolute right-4 grid size-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                >
                  <ChevronRight className="size-6" />
                </button>
              </>
            )}
          </div>

          {many ? (
            <div
              className="flex h-24 shrink-0 items-center justify-center gap-2 px-4"
              onClick={(e) => e.stopPropagation()}
            >
              {items.map((it, i) => (
                <button
                  key={`${it.url}-${i}`}
                  type="button"
                  aria-label={`Show ${it.name}`}
                  onClick={() => {
                    setZoom(null);
                    setIndex(i);
                  }}
                  className={cn(
                    "size-14 overflow-hidden rounded-lg ring-2 transition-all",
                    i === index
                      ? "opacity-100 ring-brand"
                      : "opacity-50 ring-transparent hover:opacity-90",
                  )}
                >
                  <img src={it.url} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          ) : (
            <div className="h-8 shrink-0" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
