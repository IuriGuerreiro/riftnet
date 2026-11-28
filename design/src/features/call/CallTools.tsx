import { Activity, AudioLines } from "lucide-react";
import type { ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DevicePicks } from "@/features/settings/DevicePicks";
import { change, openDialog, useWorld, world } from "@/mock/world";

function Tool({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="grid size-8 place-items-center rounded-lg bg-white/5 hover:bg-white/10"
        >
          {icon}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-72 overflow-y-auto">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function CallTools() {
  useWorld();
  const poor = world.callQuality !== "good";
  const stats = [
    ["Ping", poor ? "240 ms" : "18 ms"],
    ["Packet loss", poor ? "9%" : "0%"],
    ["Jitter", poor ? "45 ms" : "2 ms"],
    ["Stream", poor ? "720p 31fps" : world.share.quality],
    ["Route", "Riftnet relay"],
  ];
  return (
    <div className="flex gap-1.5">
      <Tool
        label="Connection"
        icon={<Activity className={poor ? "size-4 text-warning" : "size-4 text-success"} />}
      >
        <p className="text-sm font-semibold">
          {poor ? "Your connection is struggling" : "Connection looks good"}
        </p>
        <p className="mb-2 text-xs text-muted-foreground">
          {poor ? "Use a wired connection or lower stream quality." : "Nothing to fix."}
        </p>
        {stats.map(([k, v]) => (
          <p key={k} className="flex justify-between py-1 text-xs">
            <span className="text-muted-foreground">{k}</span>
            <span className="tabular-nums">{v}</span>
          </p>
        ))}
      </Tool>
      <Tool label="Devices" icon={<AudioLines className="size-4" />}>
        <DevicePicks />
        <button
          type="button"
          onClick={() => openDialog({ kind: "settings", tab: "Voice and video" })}
          className="text-xs text-brand-text hover:underline"
        >
          All voice settings
        </button>
      </Tool>
    </div>
  );
}

export function CallHint() {
  useWorld();
  if (world.callQuality === "reconnecting") return <Hint text="Reconnecting to the call…" />;
  if (world.micBlocked)
    return (
      <Hint
        text="Your microphone is blocked. Nobody can hear you."
        action="Fixed it"
        onClick={() =>
          change(() => {
            world.micBlocked = false;
          })
        }
      />
    );
  if (world.callQuality === "poor")
    return <Hint text="Your connection is weak. Sound may cut out." />;
  if (world.settings.inputMode === "push")
    return <Hint text={`Hold ${world.settings.pushKey} to talk.`} />;
  return null;
}

function Hint({ text, action, onClick }: { text: string; action?: string; onClick?: () => void }) {
  return (
    <p
      role="status"
      className="mx-auto mt-3 flex items-center gap-3 rounded-full bg-warning/15 px-4 py-1.5 text-xs text-warning"
    >
      {text}
      {action && (
        <button type="button" onClick={onClick} className="font-semibold underline">
          {action}
        </button>
      )}
    </p>
  );
}
