import { HeadphoneOff, Headphones, Mic, MicOff, MonitorUp, PhoneOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { type LiveRoom, ME, server } from "@/mock/data";

import { ScreenSharePreview } from "./ScreenSharePreview";
import { SpeakingAvatar } from "./SpeakingAvatar";
import { useSpeaker } from "./useSpeaker";

function CallButton({
  label,
  on,
  danger,
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
      title={label}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "grid h-8 flex-1 place-items-center rounded-lg transition-colors",
        danger
          ? "bg-destructive/90 text-white hover:bg-destructive"
          : on
            ? "bg-foreground text-background"
            : "bg-surface-3 text-foreground hover:bg-surface-4",
      )}
    >
      {children}
    </button>
  );
}

export function CallCard({
  room,
  onLeave,
  onOpen,
  muted,
  deafened,
  sharing,
  onMute,
  onDeafen,
  onShare,
}: {
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  onMute: () => void;
  onDeafen: () => void;
  onShare: () => void;
  room: LiveRoom;
  onLeave: () => void;
  onOpen: () => void;
}) {
  const speaker = useSpeaker(room.people);

  return (
    <div className="animate-in slide-in-from-bottom-2 fade-in mx-2 mb-2 rounded-xl border border-success/25 bg-success/[0.05] p-2.5 duration-200">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 text-left">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-success">
            Voice connected
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {room.name} · {server(room.serverId)?.name}
          </span>
        </span>
        <span className="flex -space-x-1.5">
          {room.people.slice(0, 4).map((id) => (
            <SpeakingAvatar
              key={id}
              id={id}
              size={20}
              speaking={speaker === id && !(id === ME && (muted || deafened))}
              ringBg="var(--surface-1)"
            />
          ))}
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 block w-full rounded-md px-1 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {room.people.length} in call · View participants
      </button>
      {sharing && (
        <div className="mt-2">
          <ScreenSharePreview onStop={onShare} />
        </div>
      )}
      <div className="mt-2.5 flex gap-1.5">
        <CallButton label={muted ? "Unmute" : "Mute"} on={muted} onClick={onMute}>
          {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </CallButton>
        <CallButton label={deafened ? "Undeafen" : "Deafen"} on={deafened} onClick={onDeafen}>
          {deafened ? <HeadphoneOff className="size-4" /> : <Headphones className="size-4" />}
        </CallButton>
        <CallButton
          label={sharing ? "Stop sharing" : "Share screen"}
          on={sharing}
          onClick={onShare}
        >
          <MonitorUp className="size-4" />
        </CallButton>
        <CallButton label="Leave" danger onClick={onLeave}>
          <PhoneOff className="size-4" />
        </CallButton>
      </div>
    </div>
  );
}
