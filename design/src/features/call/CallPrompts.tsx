import { Phone, PhoneOff, ShieldAlert, Video } from "lucide-react";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { Toggle } from "@/components/Controls";
import { Button } from "@/components/ui/button";
import { user } from "@/mock/data";
import { change, ensureDm, systemMessage, toast, useWorld, world } from "@/mock/world";

import type { Control } from "./CallStage";

function stopRinging(missed: boolean) {
  const who = world.ringing?.who;
  if (!who) return;
  change(() => {
    world.ringing = null;
  });
  const id = ensureDm(who);
  systemMessage(id, missed ? `Missed call from ${user(who).name}.` : "Declined call.");
  if (missed) toast(`Missed call from ${user(who).name}`, { who, open: id });
}

export function IncomingCall({ onAnswer }: { onAnswer: (video: boolean) => void }) {
  useWorld();
  const ringing = world.ringing;
  const who = ringing?.who;
  useEffect(() => {
    if (!who) return;
    const timer = setTimeout(() => stopRinging(true), 20000);
    return () => clearTimeout(timer);
  }, [who]);
  if (!ringing || !world.settings.notifyCalls) return null;
  return (
    <div
      role="alertdialog"
      aria-label={`${user(ringing.who).name} is calling`}
      className="animate-in fade-in slide-in-from-top-4 fixed top-14 left-1/2 z-50 w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-border bg-popover p-4 shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <span className="animate-pulse">
          <Avatar id={ringing.who} size={48} />
        </span>
        <div>
          <p className="font-semibold">{user(ringing.who).name}</p>
          <p className="text-xs text-muted-foreground">
            Incoming {ringing.video ? "video" : "voice"} call…
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button variant="destructive" onClick={() => stopRinging(false)}>
          <PhoneOff /> Decline
        </Button>
        <Button variant="secondary" onClick={() => onAnswer(true)}>
          <Video /> Video
        </Button>
        <Button className="bg-success text-ink hover:bg-success/85" onClick={() => onAnswer(false)}>
          <Phone /> Answer
        </Button>
      </div>
    </div>
  );
}

export function SharePlayBanner({
  control,
  onStop,
  onGrant,
}: {
  control: Control | null;
  onStop: () => void;
  onGrant: (who: string) => void;
}) {
  useWorld();
  const [ok, setOk] = useState(false);
  const request = world.controlRequest;
  const box =
    "fixed top-14 left-1/2 z-50 w-96 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border-2 border-warning bg-popover p-4 text-sm shadow-2xl";
  const clear = () => {
    setOk(false);
    change(() => {
      world.controlRequest = null;
    });
  };
  if (request)
    return (
      <div role="alertdialog" aria-label="Share Play request" className={box}>
        <p className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="size-5 text-warning" /> {user(request).name} wants to control your
          screen
        </p>
        <Toggle
          label={`I trust ${user(request).name}`}
          hint="They can use your mouse and keyboard until you stop."
          on={ok}
          onChange={setOk}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={clear}>
            Deny
          </Button>
          <Button
            disabled={!ok}
            onClick={() => {
              clear();
              onGrant(request);
            }}
          >
            Allow
          </Button>
        </div>
      </div>
    );
  if (!control) return null;
  return (
    <div role="status" className={`${box} flex items-center gap-3`}>
      <ShieldAlert className="size-5 shrink-0 text-warning" />
      <p className="flex-1">
        {control.role === "host" ? (
          <>
            <b>{user(control.who).name}</b> is controlling your screen
          </>
        ) : control.active ? (
          <>
            You're controlling <b>{user(control.who).name}&apos;s</b> screen
          </>
        ) : (
          <>Waiting for {user(control.who).name} to allow control…</>
        )}
        <span className="block text-xs text-muted-foreground">Press Ctrl+Shift+F12 to stop</span>
      </p>
      <Button size="sm" variant="destructive" onClick={onStop}>
        {control.active ? "Stop" : "Cancel"}
      </Button>
    </div>
  );
}
