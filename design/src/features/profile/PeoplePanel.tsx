import { ChevronRight, Crown, Radio } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/Avatar";
import { ProfileTrigger } from "@/features/profile/ProfileCard";
import { cn } from "@/lib/utils";
import { ME, type Server, user } from "@/mock/data";

import { ActivityLine } from "./ActivityLine";

function Row({ id, live, owner }: { id: string; live?: boolean; owner?: boolean }) {
  const u = user(id);
  return (
    <ProfileTrigger
      id={id}
      side="left"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent/60",
        u.status === "offline" && "opacity-70",
      )}
    >
      <Avatar id={id} size={30} status />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-[13px] font-medium">{u.name}</span>
          {owner && <Crown aria-label="Server owner" className="size-3 shrink-0 text-warning/80" />}
        </span>
        {u.activity && u.activity.kind !== "voice" && <ActivityLine a={u.activity} />}
      </span>
      {live && (
        <span className="flex shrink-0 items-center gap-1 rounded bg-danger-fill px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white">
          <Radio className="size-2.5" /> LIVE
        </span>
      )}
    </ProfileTrigger>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export function PeoplePanel({ ids: all, server }: { ids: string[]; server?: Server }) {
  const [q, setQ] = useState("");
  const [showOffline, setShowOffline] = useState(false);
  const ids = all.filter((id) => user(id).name.toLowerCase().includes(q.trim().toLowerCase()));
  const owner = server
    ? (server.owner ?? (server.id === "owls" ? ME : server.members[1]))
    : undefined;
  const rooms = q ? [] : (server?.channels.filter((c) => (c.voice?.length ?? 0) > 0) ?? []);
  const inVoice = new Set(rooms.flatMap((r) => r.voice ?? []));
  const online = ids.filter((id) => user(id).status !== "offline" && !inVoice.has(id));
  const offline = ids.filter((id) => user(id).status === "offline");

  const offlineExpanded = Boolean(q.trim()) || showOffline;

  return (
    <aside
      aria-label="Members"
      className="w-[260px] shrink-0 overflow-y-auto border-l border-border bg-surface-1 px-2 pb-4"
    >
      <div className="sticky top-0 z-10 -mx-2 bg-surface-1 px-2 pt-2.5 pb-1">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search members"
          placeholder="Search members"
          className="h-8 w-full rounded-lg border border-white/[0.06] bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
      </div>
      {q.trim() && ids.length === 0 && (
        <p className="px-2 py-8 text-center text-xs text-muted-foreground">No one matches that.</p>
      )}
      {rooms.map((r) => (
        <div key={r.id}>
          <Label>
            <span className="text-success">{r.name}</span> · {r.voice?.length}
          </Label>
          {r.voice?.map((id) => (
            <Row key={id} id={id} live={r.live === id} owner={id === owner} />
          ))}
        </div>
      ))}
      {!(q.trim() && ids.length === 0) && <Label>Online · {online.length}</Label>}
      {online.map((id) => (
        <Row key={id} id={id} owner={id === owner} />
      ))}
      {offline.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={offlineExpanded}
            onClick={() => setShowOffline((v) => !v)}
            className="flex w-full items-center gap-1 px-2 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground"
          >
            <ChevronRight
              className={cn("size-3 transition-transform", offlineExpanded && "rotate-90")}
            />
            Offline · {offline.length}
          </button>
          {offlineExpanded && offline.map((id) => <Row key={id} id={id} owner={id === owner} />)}
        </>
      )}
    </aside>
  );
}
