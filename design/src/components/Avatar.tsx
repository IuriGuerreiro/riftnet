import { cn } from "@/lib/utils";
import { type Status, user } from "@/mock/data";

const STATUS_COLOR: Record<Status, string> = {
  online: "bg-success",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-surface-4",
};

export function StatusDot({
  status,
  size = 12,
  className,
}: {
  status: Status;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-label={status}
      style={{ width: size, height: size }}
      className={cn(
        "block rounded-full border-[3px] border-[var(--ring-bg)]",
        STATUS_COLOR[status],
        className,
      )}
    />
  );
}

export function Avatar({
  id,
  size = 36,
  status = false,
  ringBg = "var(--background)",
  className,
}: {
  id: string;
  size?: number;
  status?: boolean;
  ringBg?: string;
  className?: string;
}) {
  const u = user(id);
  const dot = Math.max(10, Math.round(size * 0.36));
  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size, ["--ring-bg" as string]: ringBg }}
    >
      <span
        className="grid size-full place-items-center rounded-full font-semibold text-white/95 select-none"
        style={{
          background: `linear-gradient(140deg, hsl(${u.hue} 55% 58%), hsl(${u.hue + 25} 50% 42%))`,
          fontSize: size * 0.42,
        }}
      >
        {u.name.at(0)}
      </span>
      {status && (
        <StatusDot status={u.status} size={dot} className="absolute -right-0.5 -bottom-0.5" />
      )}
    </span>
  );
}

export function AvatarStack({
  ids,
  size = 24,
  max = 4,
  ringBg = "var(--background)",
}: {
  ids: string[];
  size?: number;
  max?: number;
  ringBg?: string;
}) {
  const shown = ids.slice(0, max);
  const extra = ids.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((id, i) => (
        <span
          key={id}
          className="rounded-full"
          style={{ marginLeft: i === 0 ? 0 : -size * 0.3, boxShadow: `0 0 0 2px ${ringBg}` }}
        >
          <Avatar id={id} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="grid place-items-center rounded-full bg-surface-3 text-[10px] font-semibold text-muted-foreground"
          style={{
            width: size,
            height: size,
            marginLeft: -size * 0.3,
            boxShadow: `0 0 0 2px ${ringBg}`,
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
