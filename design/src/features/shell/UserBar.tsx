import { HeadphoneOff, Headphones, Mic, MicOff, Settings } from "lucide-react";
import { useState } from "react";

import { Avatar, StatusDot } from "@/components/Avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProfileBody } from "@/features/profile/ProfileCard";
import { cn } from "@/lib/utils";
import { ME, type Status, user } from "@/mock/data";
import { openDialog, setStatus, updateMe, useWorld } from "@/mock/world";

const STATUSES: Record<Status, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  invisible: "Invisible",
  offline: "Offline",
};

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
          ? "bg-destructive/15 text-destructive ring-1 ring-destructive/25 ring-inset hover:bg-destructive/25"
          : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function UserBar({
  embedded = false,
  audio,
}: {
  embedded?: boolean;
  audio?: { muted: boolean; deafened: boolean; onMute: () => void; onDeafen: () => void };
}) {
  useWorld();
  const me = user(ME);
  const [localMuted, setLocalMuted] = useState(false);
  const muted = audio?.muted ?? localMuted;
  return (
    <div className={cn("flex items-center gap-1 p-1.5", !embedded && "border-t border-border")}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Your profile and status"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 text-left hover:bg-accent"
          >
            <Avatar id={ME} size={32} status />
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] leading-tight font-semibold">
                {me.name}
              </span>
              <span className="block truncate text-[11.5px] text-muted-foreground">
                {me.customStatus ?? STATUSES[me.status]}
              </span>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-72 overflow-hidden rounded-xl p-0"
        >
          <ProfileBody u={me} />
          <div className="border-t border-border p-2">
            {Object.entries(STATUSES)
              .filter(([id]) => id !== "offline")
              .map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={me.status === id}
                  onClick={() => setStatus(id as Status)}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-sm hover:bg-accent",
                    me.status === id && "bg-accent",
                  )}
                >
                  <StatusDot status={id as Status} size={9} />
                  {text}
                </button>
              ))}
            <button
              type="button"
              onClick={() =>
                updateMe({
                  activity: me.activity ? undefined : { kind: "playing", label: "Ridgeline" },
                })
              }
              className="flex h-8 w-full items-center rounded-lg px-2 text-sm hover:bg-accent"
            >
              {me.activity ? "Hide game activity" : "Show game activity"}
            </button>
            <button
              type="button"
              onClick={() => openDialog({ kind: "settings" })}
              className="flex h-8 w-full items-center rounded-lg px-2 text-sm hover:bg-accent"
            >
              Edit profile
            </button>
          </div>
        </PopoverContent>
      </Popover>
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
      <IconToggle label="Settings" onClick={() => openDialog({ kind: "settings" })}>
        <Settings className="size-[18px]" />
      </IconToggle>
    </div>
  );
}
