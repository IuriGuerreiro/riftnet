import { MoreHorizontal, Phone, UserPlus } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/Avatar";
import { ServerIcon } from "@/components/ServerIcon";
import { MediaImage } from "@/features/media/MediaImage";
import { openChat } from "@/features/profile/openChat";
import { bannerStyle, UserMenu } from "@/features/profile/ProfileCard";
import { cn } from "@/lib/utils";
import { SERVERS, user } from "@/mock/data";

import { ACTIVITY_ICON } from "./ActivityLine";

const SHARED = [1, 2, 3, 4, 5].map((n) => `/media/photo-${n}.jpg`).concat("/media/flower.mp4");

const ACTIVITY_TONE = {
  playing: "border-brand/20 bg-brand/12 text-brand-text",
  listening: "border-success/20 bg-success/12 text-success",
  streaming: "border-destructive/20 bg-destructive/12 text-destructive",
  voice: "border-success/20 bg-success/12 text-success",
} as const;

export function ProfilePanel({ id, onCall }: { id: string; onCall: () => void }) {
  const [invited, setInvited] = useState(false);
  const [asked, setAsked] = useState(false);
  const u = user(id);
  const mutual = SERVERS.filter((s) => s.members.includes(id));
  const Icon = u.activity ? ACTIVITY_ICON[u.activity.kind] : null;

  return (
    <aside
      aria-label="Profile"
      className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface-1"
    >
      <div className="h-20 shrink-0" style={bannerStyle(u, "var(--surface-1)")} />
      <div className="-mt-10 px-4">
        <Avatar
          id={id}
          size={76}
          status
          ringBg="var(--surface-1)"
          className="rounded-full ring-[5px] ring-surface-1"
        />
        <h3 className="mt-2.5 text-[17px] leading-tight font-semibold tracking-[-0.01em]">
          {u.name}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          @{u.handle}
          {u.pronouns ? ` · ${u.pronouns}` : ""}
        </p>
        {u.customStatus && (
          <p className="mt-2.5 inline-block max-w-full truncate rounded-md border border-white/[0.06] bg-surface-2 px-2 py-1 text-xs text-foreground/90">
            {u.customStatus}
          </p>
        )}
        {u.bio && (
          <p className="mt-2.5 text-[13px] leading-[1.45] text-muted-foreground">{u.bio}</p>
        )}
        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
          <button
            type="button"
            onClick={onCall}
            className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-surface-3 text-xs font-medium hover:bg-surface-4"
          >
            <Phone className="size-3.5" /> Call
          </button>
          <button
            type="button"
            disabled={invited}
            onClick={() => setInvited(true)}
            className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-surface-3 text-xs font-medium hover:bg-surface-4"
          >
            <UserPlus className="size-3.5" /> {invited ? "Invite sent" : "Invite"}
          </button>
          <UserMenu id={id}>
            <button
              type="button"
              aria-label="More"
              className="grid size-8 place-items-center rounded-lg bg-surface-3 hover:bg-surface-4"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </UserMenu>
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
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-lg border",
                ACTIVITY_TONE[u.activity.kind],
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{u.activity.label}</p>
              {u.activity.detail && (
                <p className="truncate text-xs text-muted-foreground">{u.activity.detail}</p>
              )}
              {u.activity.since && (
                <p className="text-xs text-muted-foreground">{u.activity.since}</p>
              )}
            </div>
          </div>
          {u.activity.kind === "playing" && (
            <button
              type="button"
              disabled={asked}
              onClick={() => setAsked(true)}
              className="mt-2.5 h-7 w-full rounded-md border border-brand/25 bg-brand/12 text-xs font-medium text-brand-text hover:bg-brand/20 disabled:opacity-55"
            >
              {asked ? "Request sent" : "Ask to join"}
            </button>
          )}
        </section>
      )}

      <section className="mt-5 px-4">
        <p className="pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Mutual servers · {mutual.length}
        </p>
        {mutual.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => openChat(s.channels.find((x) => x.kind === "text")?.id ?? "")}
            className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-accent/60"
          >
            <ServerIcon server={s} size={28} />
            <span className="truncate text-sm">{s.name}</span>
          </button>
        ))}
      </section>

      <section className="mt-5 px-4 pb-8">
        <p className="pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Shared media
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {SHARED.map((src) => (
            <MediaImage
              key={src}
              src={src}
              alt=""
              loading="lazy"
              className="aspect-square w-full rounded-md border border-white/5 object-cover"
            />
          ))}
        </div>
      </section>
    </aside>
  );
}
