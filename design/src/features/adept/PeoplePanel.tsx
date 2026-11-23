import { ChevronRight, Radio } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { type Server, user } from "@/mock/data";

import { ActivityLine } from "./ActivityLine";

function Row({ id }: { id: string }) {
  const u = user(id);
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent/60",
        u.status === "offline" && "opacity-45",
      )}
    >
      <Avatar id={id} size={32} status ringBg="var(--surface-1)" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{u.name}</span>
        {u.activity && u.activity.kind !== "voice" && <ActivityLine a={u.activity} />}
      </span>
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export function PeoplePanel({ ids, server }: { ids: string[]; server?: Server }) {
  const [showOffline, setShowOffline] = useState(false);
  const rooms = server?.channels.filter((c) => (c.voice?.length ?? 0) > 0) ?? [];
  const inVoice = new Set(rooms.flatMap((r) => r.voice ?? []));
  const online = ids.filter((id) => user(id).status !== "offline" && !inVoice.has(id));
  const offline = ids.filter((id) => user(id).status === "offline");

  return (
    <aside className="w-[260px] shrink-0 overflow-y-auto border-l border-border bg-surface-1 px-2 pb-4">
      {rooms.map((r) => (
        <div key={r.id}>
          <Label>
            <span className="text-success">In {r.name}</span> — {r.voice?.length}
          </Label>
          {r.voice?.map((id) => (
            <div key={id} className="relative">
              <Row id={id} />
              {r.live === id && (
                <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[9px] font-bold text-white">
                  <Radio className="size-2.5" /> LIVE
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
      <Label>Online — {online.length}</Label>
      {online.map((id) => (
        <Row key={id} id={id} />
      ))}
      {offline.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowOffline((v) => !v)}
            className="flex w-full items-center gap-1 px-2 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground"
          >
            <ChevronRight
              className={cn("size-3 transition-transform", showOffline && "rotate-90")}
            />
            Offline — {offline.length}
          </button>
          {showOffline && offline.map((id) => <Row key={id} id={id} />)}
        </>
      )}
    </aside>
  );
}
