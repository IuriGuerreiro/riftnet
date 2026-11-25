import { Headphones, Mic, MicOff, MonitorUp, PhoneOff, Signal, Video } from "lucide-react";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { type LiveRoom, server, user } from "@/mock/data";

function useSpeaker(people: string[]) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), 1400);
    return () => clearInterval(id);
  }, []);
  return people[i % Math.max(people.length, 1)];
}

function DockButton({
  label,
  active,
  tone = "default",
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  tone?: "default" | "danger";
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid h-10 w-11 place-items-center rounded-xl transition-colors",
        tone === "danger"
          ? "bg-danger-fill text-white hover:bg-danger-fill/85"
          : active
            ? "bg-foreground text-background"
            : "bg-surface-3 text-foreground hover:bg-surface-4",
      )}
    >
      {children}
    </button>
  );
}

export function VoiceDock({ room, onLeave }: { room: LiveRoom; onLeave: () => void }) {
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const speaker = useSpeaker(room.people);

  return (
    <div className="animate-in slide-in-from-bottom-4 fade-in flex h-[68px] shrink-0 items-center gap-4 border-t border-border bg-surface-1 px-4 duration-300">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-success/15 text-success">
          <Signal className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-success">Voice connected</p>
          <p className="truncate text-xs text-muted-foreground">
            {room.name} · {server(room.serverId)?.name}
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center gap-2">
        {room.people.map((id) => (
          <span
            key={id}
            title={user(id).name}
            className={cn(
              "rounded-full ring-2 ring-offset-2 ring-offset-surface-1 transition-all duration-300",
              speaker === id ? "ring-success" : "ring-transparent",
            )}
          >
            <Avatar id={id} size={32} />
          </span>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <DockButton
          label={muted ? "Unmute" : "Mute"}
          active={muted}
          onClick={() => setMuted((m) => !m)}
        >
          {muted ? <MicOff className="size-[18px]" /> : <Mic className="size-[18px]" />}
        </DockButton>
        <DockButton label="Deafen">
          <Headphones className="size-[18px]" />
        </DockButton>
        <DockButton label="Camera">
          <Video className="size-[18px]" />
        </DockButton>
        <DockButton
          label={sharing ? "Stop sharing" : "Share screen"}
          active={sharing}
          onClick={() => setSharing((s) => !s)}
        >
          <MonitorUp className="size-[18px]" />
        </DockButton>
        <DockButton label="Leave" tone="danger" onClick={onLeave}>
          <PhoneOff className="size-[18px]" />
        </DockButton>
      </div>
    </div>
  );
}
