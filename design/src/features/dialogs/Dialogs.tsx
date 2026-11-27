import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Pick, Toggle } from "@/components/Controls";
import { Button } from "@/components/ui/button";
import { ServerSettings } from "@/features/server/ServerSettings";
import { SettingsScreen, ShortcutList } from "@/features/settings/SettingsScreen";
import { cn } from "@/lib/utils";
import { change, openDialog, type ShareOptions, useWorld, world } from "@/mock/world";

import { Forward, GroupMembers, NewDm, RenameGroup, Report } from "./HomeDialogs";
import { Modal } from "./Modal";
import { AddServer, ChannelForm, Discover, Invite } from "./ServerDialogs";

const SOURCES = [
  ["Screen 1", "photo-1.jpg"],
  ["Screen 2", "photo-2.jpg"],
  ["Ridgeline", "photo-4.jpg"],
  ["Browser", "photo-3.jpg"],
] as const;

function SharePicker({ onShare }: { onShare: () => void }) {
  const [o, setO] = useState<ShareOptions>(world.share);
  const set = (patch: Partial<ShareOptions>) => setO((x) => ({ ...x, ...patch }));
  return (
    <Modal title="Share your screen" wide>
      <div className="grid grid-cols-2 gap-3">
        {SOURCES.map(([name, img]) => (
          <button
            key={name}
            type="button"
            aria-pressed={o.source === name}
            onClick={() => set({ source: name })}
            className={cn(
              "overflow-hidden rounded-xl border-2 text-left text-sm",
              o.source === name ? "border-brand" : "border-transparent hover:border-surface-4",
            )}
          >
            <img src={`/media/${img}`} alt="" className="aspect-video w-full object-cover" />
            <span className="block bg-surface-2 px-3 py-2">{name}</span>
          </button>
        ))}
      </div>
      <Pick
        label="Quality"
        value={o.quality}
        options={["Source 60fps", "1440p 60fps", "1080p 60fps", "720p 60fps", "1080p 30fps"]}
        onChange={(quality) => set({ quality })}
      />
      <Toggle label="Share sound" on={o.audio} onChange={(audio) => set({ audio })} />
      <Toggle
        label="Allow Share Play"
        hint="Viewers can request control. You approve each request."
        on={o.control}
        onChange={(control) => set({ control })}
      />
      <Button
        onClick={() => {
          change(() => {
            world.share = o;
          });
          openDialog(null);
          onShare();
        }}
      >
        Start sharing
      </Button>
    </Modal>
  );
}

function Expired() {
  const navigate = useNavigate();
  return (
    <Modal title="Your session ended" description="Log in again. Your drafts are still here.">
      <Button
        onClick={() => {
          openDialog(null);
          void navigate({ to: "/login" });
        }}
      >
        Log in
      </Button>
    </Modal>
  );
}

export function Dialogs({ onShare }: { onShare: () => void }) {
  useWorld();
  const d = world.dialog;
  if (!d) return null;
  switch (d.kind) {
    case "newDm":
      return <NewDm />;
    case "newGroup":
      return <GroupMembers />;
    case "addMembers":
      return <GroupMembers id={d.id} />;
    case "renameGroup":
      return <RenameGroup id={d.id} />;
    case "addServer":
      return <AddServer key={d.code} code={d.code} />;
    case "discover":
      return <Discover />;
    case "invite":
      return <Invite id={d.server} />;
    case "channel":
      return <ChannelForm id={d.server} channel={d.channel} />;
    case "serverSettings":
      return <ServerSettings id={d.server} tab={d.tab} />;
    case "forward":
      return <Forward text={d.text} />;
    case "report":
      return <Report what={d.what} />;
    case "share":
      return <SharePicker onShare={onShare} />;
    case "shortcuts":
      return (
        <Modal title="Keyboard shortcuts">
          <ShortcutList />
        </Modal>
      );
    case "settings":
      return <SettingsScreen tab={d.tab} />;
    case "expired":
      return <Expired />;
    case "confirm":
      return (
        <Modal title={d.title} description={d.body}>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => openDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                openDialog(null);
                d.run();
              }}
            >
              {d.action}
            </Button>
          </div>
        </Modal>
      );
  }
}
