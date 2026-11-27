import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";
import { type Status, user } from "@/mock/data";

export const TONES = [
  { bg: "#232038", fg: "#c7c0ff" },
  { bg: "#1b2736", fg: "#9ec5f5" },
  { bg: "#182b27", fg: "#89d6be" },
  { bg: "#2d241a", fg: "#e6bf8c" },
  { bg: "#2c1f27", fg: "#e4a9c0" },
  { bg: "#22252e", fg: "#bec3d0" },
] as const;

export function hashId(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

export const toneFor = (id: string) =>
  id === "me" ? TONES[0] : (TONES[hashId(id) % TONES.length] ?? TONES[0]);

export const STATUS_LABEL: Record<Status, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  invisible: "Invisible",
  offline: "Offline",
};

export function StatusDot({
  status,
  size = 10,
  className,
  style,
}: {
  status: Status;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      style={style}
      role="img"
      aria-label={STATUS_LABEL[status]}
      viewBox="0 0 12 12"
      width={size}
      height={size}
      className={cn("block shrink-0", className)}
    >
      {status === "online" && <circle cx="6" cy="6" r="6" fill="var(--success)" />}
      {status === "idle" && (
        <path d="M7.6 0.4A5.8 5.8 0 1 0 11.6 8.2A4.5 4.5 0 0 1 7.6 0.4Z" fill="var(--warning)" />
      )}
      {status === "dnd" && (
        <>
          <circle cx="6" cy="6" r="6" fill="var(--destructive)" />
          <rect x="2.6" y="4.9" width="6.8" height="2.2" rx="1.1" fill="var(--adept-ink)" />
        </>
      )}
      {(status === "offline" || status === "invisible") && (
        <circle cx="6" cy="6" r="4.4" fill="none" stroke="#6b7080" strokeWidth="2.4" />
      )}
    </svg>
  );
}

export function Face({ id, size }: { id: string; size: number }) {
  const u = user(id);
  if (u.avatar)
    return (
      <img
        src={u.avatar}
        alt=""
        className="size-full object-cover"
        style={{ objectPosition: u.avatarPos ?? "50% 50%" }}
      />
    );
  const tone = toneFor(u.id);
  return (
    <span
      className="grid size-full place-items-center overflow-hidden select-none"
      style={{ background: `color-mix(in srgb, ${tone.fg} 45%, ${tone.bg})`, color: "#fff" }}
    >
      <span
        className="relative font-display leading-none font-semibold"
        style={{ fontSize: size < 24 ? Math.max(9, size * 0.5) : Math.round(size * 0.42) }}
      >
        {u.name.charAt(0).toUpperCase()}
      </span>
    </span>
  );
}

export function Avatar({
  id,
  size = 36,
  status = false,
  className,
}: {
  id: string;
  size?: number;
  status?: boolean;
  ringBg?: string;
  className?: string;
}) {
  const u = user(id);
  const dot = size <= 24 ? 8 : size <= 36 ? 10 : size <= 52 ? 12 : 16;
  const gap = size >= 48 ? 3 : 2;
  const c = size - dot / 2 - (size >= 60 ? size * 0.04 : 0);
  const cut = dot / 2 + gap;
  const mask = status
    ? `radial-gradient(circle at ${c}px ${c}px, transparent ${cut}px, #000 ${cut + 0.5}px)`
    : undefined;
  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <span
        className="block size-full overflow-hidden rounded-full"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        <Face id={id} size={size} />
      </span>
      {status && (
        <StatusDot
          status={u.status}
          size={dot}
          className="absolute"
          style={{ left: c - dot / 2, top: c - dot / 2 }}
        />
      )}
    </span>
  );
}

export function AvatarStack({
  ids,
  size = 24,
  max = 4,
}: {
  ids: string[];
  size?: number;
  max?: number;
  ringBg?: string;
}) {
  const shown = ids.slice(0, max);
  const extra = ids.length - shown.length;
  const overlap = Math.round(size * 0.28);
  const cut = size / 2 + 1.5;
  const mask = `radial-gradient(circle at ${size * 1.5 - overlap}px ${size / 2}px, transparent ${cut}px, #000 ${cut + 0.5}px)`;
  return (
    <span className="flex shrink-0 items-center">
      {shown.map((id, i) => {
        const covered = i < shown.length - 1 || extra > 0;
        return (
          <span
            key={id}
            className="inline-flex rounded-full"
            style={{
              marginLeft: i === 0 ? 0 : -overlap,
              ...(covered ? { maskImage: mask, WebkitMaskImage: mask } : {}),
            }}
          >
            <Avatar id={id} size={size} />
          </span>
        );
      })}
      {extra > 0 && (
        <span
          className="grid place-items-center rounded-full bg-surface-3 text-[9px] font-semibold text-muted-foreground"
          style={{ width: size, height: size, marginLeft: -overlap }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
