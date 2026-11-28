import { toneFor } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import type { Server } from "@/mock/data";

const EMBLEMS = {
  owls: {
    bg: "#17152b",
    fg: "#ecedf1",
    svg: (
      <svg viewBox="0 0 40 40" aria-hidden className="size-[62%]">
        <polygon points="8,10 17,15 14,27 7,21" fill="currentColor" opacity="0.92" />
        <polygon points="32,10 23,15 26,27 33,21" fill="currentColor" opacity="0.92" />
        <polygon points="15,29 20,33 25,29 20,24" fill="currentColor" opacity="0.55" />
        <polygon points="12,18 17,19.5 14.5,22.5" fill="#8b45ff" />
        <polygon points="28,18 23,19.5 25.5,22.5" fill="#8b45ff" />
      </svg>
    ),
  },
  forge: {
    bg: "#231b15",
    fg: "#f0dec8",
    svg: (
      <svg viewBox="0 0 40 40" aria-hidden className="size-[60%]">
        <rect x="8" y="22" width="24" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
        <polygon points="12,28 28,28 25,33 15,33" fill="currentColor" opacity="0.55" />
        <polygon points="20,7 25,13 20,19 15,13" fill="#e5a45c" />
        <rect x="28" y="10" width="3.5" height="3.5" rx="0.75" fill="#e5a45c" opacity="0.75" />
      </svg>
    ),
  },
} as const;

export function ServerIcon({
  server,
  size = 48,
  active = false,
  className,
}: {
  server: Server;
  size?: number;
  active?: boolean;
  className?: string;
}) {
  const emblem = server.emblem ? EMBLEMS[server.emblem] : undefined;
  const tone = toneFor(server.id);
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden font-display font-bold ring-1 ring-white/[0.09] ring-inset select-none",
        "transition-[border-radius] duration-150",
        active ? "rounded-[28%]" : "rounded-[35%] group-hover/tile:rounded-[28%]",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.31),
        background: emblem?.bg ?? tone.bg,
        color: emblem?.fg ?? tone.fg,
      }}
    >
      {server.icon ? (
        <img src={server.icon} alt="" className="size-full object-cover" />
      ) : emblem ? (
        emblem.svg
      ) : (
        <span className="tracking-tight">{server.short}</span>
      )}
    </span>
  );
}
