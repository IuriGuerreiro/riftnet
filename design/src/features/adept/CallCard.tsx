import { Loader2, MonitorUp, PhoneOff, PhoneOutgoing, Signal, SignalLow } from "lucide-react";

import { cn } from "@/lib/utils";
import { type LiveRoom, ME, server } from "@/mock/data";
import { useWorld, world } from "@/mock/world";

import { SpeakingAvatar } from "./SpeakingAvatar";
import { UserCallMenu } from "./UserCallMenu";
import { useSpeaker } from "./useSpeaker";

export function CallCard({
  room,
  onLeave,
  onOpen,
  inStage,
  ringing,
  onShowPreview,
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
  inStage: boolean;
  ringing: boolean;
  onShowPreview?: () => void;
}) {
  useWorld();
  const speaker = useSpeaker(room.people);
  const quality = world.callQuality;
  const tone = ringing
    ? { bar: "bg-brand", text: "text-foreground", label: "Calling…", ping: "", Icon: PhoneOutgoing }
    : quality === "reconnecting"
      ? { bar: "bg-warning", text: "text-warning", label: "Reconnecting…", ping: "", Icon: Loader2 }
      : quality === "poor"
        ? {
            bar: "bg-warning",
            text: "text-warning",
            label: "Weak connection",
            ping: "240 ms",
            Icon: SignalLow,
          }
        : {
            bar: "bg-success",
            text: "text-success",
            label: "Connected",
            ping: "18 ms",
            Icon: Signal,
          };
  const max = room.people.length > 6 ? 5 : 6;
  const shown = room.people.slice(0, max);
  const extra = room.people.length - shown.length;

  return (
    <div className="animate-in fade-in relative border-b border-border p-2.5 duration-200">
      <span className={cn("absolute inset-x-0 top-0 h-0.5", tone.bar)} />
      <button
        type="button"
        onClick={onOpen}
        className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span className="flex items-center gap-1.5">
          <tone.Icon
            className={cn(
              "size-3.5 shrink-0",
              tone.text,
              tone.Icon === Loader2 && "animate-spin motion-reduce:animate-none",
            )}
          />
          <span className={cn("truncate text-xs font-semibold", tone.text)}>{tone.label}</span>
          {tone.ping && (
            <span
              className={cn(
                "ml-auto shrink-0 text-[11px] tabular-nums",
                quality === "poor" ? "text-warning" : "text-muted-foreground",
              )}
            >
              {tone.ping}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-xs">
          <span className="truncate font-medium text-foreground">{room.name}</span>
          <span className="shrink-0 text-muted-foreground">·</span>
          <span className="truncate text-muted-foreground">
            {ringing ? "Ringing" : (server(room.serverId)?.name ?? "Direct call")}
          </span>
        </span>
      </button>
      <div className="mt-2.5 flex items-center gap-1.5">
        {shown.map((id) => (
          <UserCallMenu key={id} id={id} self={{ muted, deafened, onMute, onDeafen }}>
            <span className="inline-flex">
              <SpeakingAvatar
                id={id}
                size={22}
                ringBg="var(--surface-1)"
                speaking={!ringing && speaker === id && !(id === ME && (muted || deafened))}
              />
            </span>
          </UserCallMenu>
        ))}
        {extra > 0 && (
          <span className="grid size-[22px] place-items-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted-foreground tabular-nums">
            +{extra}
          </span>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto h-6 shrink-0 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        >
          {inStage ? "Chat" : "Open"}
        </button>
      </div>
      {(sharing || onShowPreview) && (
        <div className="mt-2 flex h-7 items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-2 text-[11px]">
          <MonitorUp className="size-3 shrink-0 text-brand-text" />
          <span className="min-w-0 flex-1 truncate font-medium text-brand-text">
            {sharing ? `Sharing · ${world.share.quality}` : "Stream hidden"}
          </span>
          {onShowPreview && (
            <button
              type="button"
              onClick={onShowPreview}
              className="shrink-0 font-medium text-foreground/80 hover:text-foreground"
            >
              Show
            </button>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={sharing}
          onClick={onShare}
          className={cn(
            "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors",
            sharing
              ? "bg-brand/15 text-brand-text ring-1 ring-brand/30 ring-inset hover:bg-brand/25"
              : "bg-surface-2 text-foreground hover:bg-surface-3",
          )}
        >
          <MonitorUp className="size-3.5" />
          {sharing ? "Stop sharing" : "Share screen"}
        </button>
        <button
          type="button"
          aria-label={ringing ? "Cancel call" : "Leave call"}
          title={ringing ? "Cancel call" : "Leave call"}
          onClick={onLeave}
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-danger-fill/15 text-destructive transition-colors hover:bg-danger-fill hover:text-white"
        >
          <PhoneOff className="size-4" />
        </button>
      </div>
    </div>
  );
}
