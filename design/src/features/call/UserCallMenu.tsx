import {
  Ban,
  HeadphoneOff,
  MessageSquare,
  MicOff,
  RotateCcw,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ReactElement } from "react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { openChat } from "@/features/profile/openChat";
import { ME, user } from "@/mock/data";
import {
  blockUser,
  ensureDm,
  isSilenced,
  openDialog,
  setSilenced,
  setVolume,
  useWorld,
  volumeOf,
} from "@/mock/world";

export interface SelfControls {
  muted: boolean;
  deafened: boolean;
  onMute: () => void;
  onDeafen: () => void;
}

function VolumeItem({ label, target }: { label: string; target: string }) {
  const value = volumeOf(target);
  const silenced = isSilenced(target);
  const set = (v: number) => setVolume(target, Math.min(200, Math.max(0, v)));
  return (
    <ContextMenuItem
      aria-label={`${label} ${value}%`}
      className="block focus:bg-accent/50"
      onSelect={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        e.stopPropagation();
        set(value + (e.key === "ArrowRight" ? 5 : -5));
      }}
    >
      <span className="flex items-center justify-between text-xs">
        {label}
        <span className="text-muted-foreground tabular-nums">
          {silenced ? "Muted" : `${value}%`}
        </span>
      </span>
      <input
        type="range"
        tabIndex={-1}
        aria-hidden
        min={0}
        max={200}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className={`mt-2 w-full accent-brand ${silenced ? "opacity-40" : ""}`}
      />
    </ContextMenuItem>
  );
}

export function UserCallMenu({
  id,
  self,
  children,
}: {
  id: string;
  self?: SelfControls;
  children: ReactElement;
}) {
  useWorld();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuLabel>{user(id).name}</ContextMenuLabel>
        {id === ME ? (
          <>
            {self && (
              <>
                <ContextMenuCheckboxItem checked={self.muted} onCheckedChange={self.onMute}>
                  Mute <MicOff className="ml-auto" />
                </ContextMenuCheckboxItem>
                <ContextMenuCheckboxItem checked={self.deafened} onCheckedChange={self.onDeafen}>
                  Deafen <HeadphoneOff className="ml-auto" />
                </ContextMenuCheckboxItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem
              onSelect={() => openDialog({ kind: "settings", tab: "Voice and video" })}
            >
              <Settings /> Voice settings
            </ContextMenuItem>
          </>
        ) : (
          <>
            <VolumeItem label="Volume" target={id} />
            <ContextMenuCheckboxItem
              checked={isSilenced(id)}
              onCheckedChange={(on) => setSilenced(id, on)}
              onSelect={(e) => e.preventDefault()}
            >
              Mute for me <VolumeX className="ml-auto" />
            </ContextMenuCheckboxItem>
            <ContextMenuItem
              disabled={volumeOf(id) === 100 && !isSilenced(id)}
              onSelect={(e) => {
                e.preventDefault();
                setVolume(id, 100);
              }}
            >
              <RotateCcw /> Reset volume
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => openChat(ensureDm(id))}>
              <MessageSquare /> Message
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => blockUser(id)}>
              <Ban /> Block
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function StreamMenu({ id, children }: { id: string; children: ReactElement }) {
  useWorld();
  const target = `stream:${id}`;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuLabel className="flex items-center gap-2">
          <Volume2 className="size-4" /> {user(id).name}&apos;s stream
        </ContextMenuLabel>
        <VolumeItem label="Stream volume" target={target} />
        <ContextMenuCheckboxItem
          checked={isSilenced(target)}
          onCheckedChange={(on) => setSilenced(target, on)}
          onSelect={(e) => e.preventDefault()}
        >
          Mute stream
        </ContextMenuCheckboxItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
