import { Link } from "@tanstack/react-router";
import { LayoutGrid, X } from "lucide-react";
import { useState } from "react";

import { EMOJI_SETS, setEmojiSet, useEmojiSet } from "@/features/emoji/sets";
import { cn } from "@/lib/utils";
import { MOCK_HINTS } from "@/mock/auth";
import { SERVERS } from "@/mock/data";
import { change, pushMessage, toast, world } from "@/mock/world";

const SCREENS = [
  { label: "Loading", to: "/loading", search: {} },
  { label: "Loading · hold", to: "/loading", search: { state: "hold" } },
  { label: "Loading · offline", to: "/loading", search: { state: "error" } },
  { label: "Login", to: "/login", search: {} },
  { label: "Register", to: "/register", search: {} },
  { label: "Forgot password", to: "/forgot", search: {} },
  { label: "Verify email", to: "/verify", search: {} },
  { label: "Username", to: "/username", search: {} },
  { label: "Adept app", to: "/app", search: {} },
] as const;

const SCENARIOS: [string, () => void][] = [
  ["Someone calls you", () => void (world.ringing = { who: "lea", video: false })],
  ["Someone wants control", () => void (world.controlRequest = "tom")],
  ["Weak call connection", () => void (world.callQuality = "poor")],
  ["Call reconnecting", () => void (world.callQuality = "reconnecting")],
  ["Call back to normal", () => void (world.callQuality = "good")],
  ["Microphone blocked", () => void (world.micBlocked = true)],
  [
    "New message",
    () => {
      const id = "dm-kai";
      pushMessage(id, { author: "kai", text: "you around?" });
      toast("Kestrel: you around?", { who: "kai", open: id });
    },
  ],
  ["Go offline", () => void (world.connection = "offline")],
  ["Reconnecting", () => void (world.connection = "reconnecting")],
  ["Session ended", () => void (world.dialog = { kind: "expired" })],
  ["Update available", () => void (world.update = "available")],
  [
    "Removed from a server",
    () => {
      const s = SERVERS.find((x) => x.id === "drift");
      if (s) s.denied = true;
    },
  ],
  ["Brand new account", () => void (world.empty = !world.empty)],
];

export function DevSwitcher() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed right-0 bottom-0 z-50 flex flex-col-reverse items-end gap-2">
      {open && (
        <div className="animate-in fade-in slide-in-from-bottom-2 max-h-[85vh] w-60 overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-2xl shadow-black/50 duration-200">
          <p className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Screens
          </p>
          <nav className="grid">
            {SCREENS.map((s) => (
              <Link
                key={s.label}
                to={s.to}
                search={s.search}
                activeOptions={{ includeSearch: true }}
                className="rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-accent hover:text-foreground data-[status=active]:bg-brand/15 data-[status=active]:text-brand-text"
              >
                {s.label}
              </Link>
            ))}
          </nav>
          <div className="mt-2 border-t border-border pt-2">
            <p className="px-2 pb-1 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Make it happen
            </p>
            {SCENARIOS.map(([label, run]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  change(run);
                  setOpen(false);
                }}
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-accent hover:text-foreground"
              >
                {label}
              </button>
            ))}
          </div>
          <EmojiStylePicker />
          <div className="mt-2 border-t border-border px-2 pt-2 pb-1">
            <p className="pb-1 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Mock triggers
            </p>
            {MOCK_HINTS.map(([label, value]) => (
              <p key={label} className="flex justify-between gap-2 py-0.5 text-xs">
                <span className="text-muted-foreground">{label}</span>
                <code className="text-foreground/80">{value}</code>
              </p>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close screen switcher" : "Open screen switcher"}
        className="grid size-6 place-items-center rounded-full opacity-60 hover:opacity-100 border border-border bg-popover text-muted-foreground shadow-lg transition-colors hover:text-foreground"
      >
        {open ? <X className="size-4" /> : <LayoutGrid className="size-3" />}
      </button>
    </div>
  );
}

function EmojiStylePicker() {
  const current = useEmojiSet();
  return (
    <div className="mt-2 border-t border-border px-2 pt-3 pb-1">
      <p className="pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        Emoji style
      </p>
      <div className="flex flex-wrap gap-1">
        {EMOJI_SETS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setEmojiSet(s.id)}
            className={cn(
              "h-6 rounded-md px-2 text-[11px] font-medium transition-colors",
              current === s.id
                ? "bg-brand/20 text-brand-text"
                : "bg-surface-3 text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
