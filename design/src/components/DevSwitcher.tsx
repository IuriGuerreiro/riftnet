import { Link } from "@tanstack/react-router";
import { LayoutGrid, X } from "lucide-react";
import { useState } from "react";

import { MOCK_HINTS } from "@/mock/auth";

const SCREENS = [
  { label: "Loading", to: "/loading", search: {} },
  { label: "Loading · hold", to: "/loading", search: { state: "hold" } },
  { label: "Loading · offline", to: "/loading", search: { state: "error" } },
  { label: "Login", to: "/login", search: {} },
  { label: "Register", to: "/register", search: {} },
  { label: "Username", to: "/username", search: {} },
  { label: "App", to: "/app", search: {} },
] as const;

export function DevSwitcher() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="animate-in fade-in slide-in-from-bottom-2 w-60 rounded-xl border border-border bg-popover p-2 shadow-2xl shadow-black/50 duration-200">
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
