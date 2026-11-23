import { MessageSquare, Phone, UserPlus } from "lucide-react";

import { Avatar } from "@/components/Avatar";
import { ServerIcon } from "@/components/ServerIcon";
import { SERVERS, user } from "@/mock/data";

import { ACTIVITY_ICON } from "./ActivityLine";

const SHARED = [1, 2, 3, 4, 5].map((n) => `/media/photo-${n}.jpg`).concat("/media/flower.gif");

const STATUS_LABEL = { online: "Online", idle: "Idle", dnd: "Do not disturb", offline: "Offline" };

export function ProfilePanel({ id }: { id: string }) {
  const u = user(id);
  const mutual = SERVERS.filter((s) => s.members.includes(id));
  const Icon = u.activity ? ACTIVITY_ICON[u.activity.kind] : null;

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface-1">
      <div
        className="h-24 shrink-0"
        style={{
          background: `linear-gradient(135deg, hsl(${u.hue} 45% 30%), hsl(${u.hue + 40} 40% 18%))`,
        }}
      />
      <div className="-mt-10 px-4">
        <Avatar
          id={id}
          size={76}
          status
          ringBg="var(--surface-1)"
          className="rounded-full ring-[5px] ring-surface-1"
        />
        <h3 className="mt-2 text-lg leading-tight font-semibold">{u.name}</h3>
        <p className="text-sm text-muted-foreground">
          @{u.handle} · {STATUS_LABEL[u.status]}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-surface-3 text-xs font-medium hover:bg-surface-4"
          >
            <Phone className="size-3.5" /> Call
          </button>
          <button
            type="button"
            className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-surface-3 text-xs font-medium hover:bg-surface-4"
          >
            <UserPlus className="size-3.5" /> Invite
          </button>
        </div>
      </div>

      {u.activity && Icon && (
        <section className="mx-4 mt-5 rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {u.activity.kind === "playing"
              ? "Playing"
              : u.activity.kind === "listening"
                ? "Listening"
                : u.activity.kind === "streaming"
                  ? "Streaming"
                  : "In voice"}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-lg"
              style={{
                background: `linear-gradient(135deg, hsl(${u.hue + 120} 40% 35%), hsl(${u.hue + 160} 35% 20%))`,
              }}
            >
              <Icon className="size-5 text-white/90" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{u.activity.label}</p>
              {u.activity.detail && (
                <p className="truncate text-xs text-muted-foreground">{u.activity.detail}</p>
              )}
              {u.activity.since && <p className="text-xs text-success">for {u.activity.since}</p>}
            </div>
          </div>
          {u.activity.kind === "playing" && (
            <button
              type="button"
              className="mt-3 h-8 w-full rounded-lg bg-brand text-xs font-semibold text-white hover:bg-brand-hover"
            >
              Ask to join
            </button>
          )}
        </section>
      )}

      <section className="mt-5 px-4">
        <p className="pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Mutual servers — {mutual.length}
        </p>
        {mutual.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-accent/60"
          >
            <ServerIcon server={s} size={28} />
            <span className="truncate text-sm">{s.name}</span>
          </div>
        ))}
      </section>

      <section className="mt-5 px-4 pb-5">
        <p className="pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Shared media
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {SHARED.map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              loading="lazy"
              className="aspect-square w-full rounded-md border border-white/5 object-cover transition-opacity hover:opacity-80"
            />
          ))}
        </div>
        <button
          type="button"
          className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <MessageSquare className="size-3.5" /> Search in conversation
        </button>
      </section>
    </aside>
  );
}
