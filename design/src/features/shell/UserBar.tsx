import { HeadphoneOff, Headphones, Mic, MicOff, Settings } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { ME, user } from "@/mock/data";

export function IconToggle({
  label,
  on = false,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  on?: boolean;
  danger?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center rounded-md transition-colors",
        danger && on
          ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function UserBar({
  ringBg = "var(--surface-1)",
  audio,
}: {
  ringBg?: string;
  audio?: { muted: boolean; deafened: boolean; onMute: () => void; onDeafen: () => void };
}) {
  const me = user(ME);
  const [localMuted, setLocalMuted] = useState(false);
  const muted = audio?.muted ?? localMuted;
  return (
    <div className="flex items-center gap-2 border-t border-border p-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 text-left hover:bg-accent"
      >
        <Avatar id={ME} size={34} status ringBg={ringBg} />
        <span className="min-w-0">
          <span className="block truncate text-sm leading-tight font-semibold">{me.name}</span>
          <span className="block truncate text-xs text-muted-foreground">Online</span>
        </span>
      </button>
      <IconToggle
        label={muted ? "Unmute" : "Mute"}
        on={muted}
        danger
        onClick={audio?.onMute ?? (() => setLocalMuted((m) => !m))}
      >
        {muted ? <MicOff className="size-[18px]" /> : <Mic className="size-[18px]" />}
      </IconToggle>
      <IconToggle
        label={audio?.deafened ? "Undeafen" : "Deafen"}
        on={audio?.deafened}
        danger
        onClick={audio?.onDeafen}
      >
        {audio?.deafened ? (
          <HeadphoneOff className="size-[18px]" />
        ) : (
          <Headphones className="size-[18px]" />
        )}
      </IconToggle>
      <IconToggle label="Settings">
        <Settings className="size-[18px]" />
      </IconToggle>
    </div>
  );
}
