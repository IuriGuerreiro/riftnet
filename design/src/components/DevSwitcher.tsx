import { Link } from "@tanstack/react-router";
import { LayoutGrid, X } from "lucide-react";
import { useState } from "react";

import { EMOJI_SETS, setEmojiSet, useEmojiSet } from "@/features/emoji/sets";
import { cn } from "@/lib/utils";
import { MOCK_HINTS } from "@/mock/auth";

const SCREENS = [
  { label: "Loading", to: "/loading", search: {} },
  { label: "Loading · hold", to: "/loading", search: { state: "hold" } },
  { label: "Loading · offline", to: "/loading", search: { state: "error" } },
  { label: "Login", to: "/login", search: {} },
  { label: "Register", to: "/register", search: {} },
  { label: "Username", to: "/username", search: {} },
] as const;

const LAYOUTS = [
  { label: "A · Classic", hint: "Discord-style", to: "/app/classic" },
  { label: "B · Inbox", hint: "One unified list", to: "/app/inbox" },
  { label: "C · Live", hint: "Voice & play first", to: "/app/live" },
  { label: "D · Focus", hint: "Tabs + ⌘K", to: "/app/focus" },
  { label: "E · Adept", hint: "Classic, evolved", to: "/app/adept" },
] as const;

export function DevSwitcher() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed top-1/2 right-3 z-50 flex -translate-y-1/2 flex-row-reverse items-center gap-2">
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
                className="rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-accent hover:text-foreground data-[status=active]:bg-brand/15 data-[status=active]:text-brand"
              >
                {s.label}
              </Link>
            ))}
          </nav>
          <p className="mt-2 border-t border-border px-2 pt-3 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Main screen layouts
          </p>
          <nav className="grid">
            {LAYOUTS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-accent hover:text-foreground data-[status=active]:bg-brand/15 data-[status=active]:text-brand"
              >
                {l.label}
                <span className="text-[11px] text-muted-foreground">{l.hint}</span>
              </Link>
            ))}
          </nav>
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
        className="grid size-10 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow-lg transition-colors hover:text-foreground"
      >
        {open ? <X className="size-4" /> : <LayoutGrid className="size-4" />}
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
                ? "bg-brand/20 text-brand"
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
