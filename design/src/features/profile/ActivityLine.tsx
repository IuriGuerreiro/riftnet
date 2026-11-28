import { Gamepad2, Headphones, MonitorPlay, Volume2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Activity } from "@/mock/data";

export const ACTIVITY_ICON = {
  playing: Gamepad2,
  listening: Headphones,
  streaming: MonitorPlay,
  voice: Volume2,
} as const;

export function ActivityLine({ a, className }: { a: Activity; className?: string }) {
  const Icon = ACTIVITY_ICON[a.kind];
  return (
    <span
      className={cn("flex min-w-0 items-center gap-1 text-xs text-muted-foreground", className)}
    >
      <Icon className={cn("size-3 shrink-0", a.kind === "voice" && "text-success")} />
      <span className="truncate">{a.label}</span>
    </span>
  );
}
