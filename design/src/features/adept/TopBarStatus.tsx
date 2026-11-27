import { AtSign, Bell, CheckCheck, Headphones, UserPlus } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarStack } from "@/components/Avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmojiText } from "@/features/emoji/EmojiText";
import { cn } from "@/lib/utils";
import { FRIENDS, LIVE_ROOMS, server, user } from "@/mock/data";
import { answerRequest, useWorld, world } from "@/mock/world";

interface Note {
  id: string;
  kind: "mention" | "reply" | "request";
  who: string;
  where?: string;
  text: string;
  at: string;
  open?: string;
}

const NOTES: Note[] = [
  {
    id: "n1",
    kind: "mention",
    who: "tom",
    where: "#general · Late Shift",
    text: "@iuri you in?",
    at: "2m",
    open: "owls-general",
  },
  {
    id: "n2",
    kind: "mention",
    who: "maya",
    where: "Direct message",
    text: "ok one more game then I'm out 😅",
    at: "4m",
    open: "dm-maya",
  },
  {
    id: "n3",
    kind: "mention",
    who: "ben",
    where: "#scrims · Ridgeline Scrims",
    text: "@iuri can you sub in at 9?",
    at: "31m",
    open: "drift-scrims",
  },
  {
    id: "n4",
    kind: "reply",
    who: "lea",
    where: "Lisbon trip 🌊",
    text: "I found a place near Alfama",
    at: "14m",
    open: "group-trip",
  },
  { id: "n5", kind: "request", who: "rui", text: "sent you a friend request", at: "1h" },
];

const IN_VOICE = [...new Set(LIVE_ROOMS.flatMap((r) => r.people))];

function Pill({
  onClick,
  children,
  label,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="flex h-7 items-center gap-2 whitespace-nowrap rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      {children}
    </button>
  );
}

export function TopBarStatus({
  onOpen,
  onFriends,
  onLive,
}: {
  onOpen: (id: string) => void;
  onFriends: () => void;
  onLive: () => void;
}) {
  useWorld();
  const request = world.incoming.includes("rui")
    ? "pending"
    : world.friends.has("rui")
      ? "accepted"
      : "ignored";
  const ONLINE = (world.empty ? [] : [...world.friends])
    .map(user)
    .filter((f) => f.status !== "offline");
  const [filter, setFilter] = useState<"all" | "unread" | "mentions">("all");
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Set<string>>(new Set());
  const shown = NOTES.filter((n) =>
    filter === "unread" ? !read.has(n.id) : filter === "mentions" ? n.kind === "mention" : true,
  );
  const unread = NOTES.filter((n) => !read.has(n.id)).length;

  return (
    <div className="flex items-center justify-end gap-1">
      <Pill label="Friends online" onClick={onFriends}>
        <span className="hidden lg:block">
          <AvatarStack ids={ONLINE.map((f) => f.id)} size={18} max={3} ringBg="var(--adept-ink)" />
        </span>
        <span>
          <span className="text-foreground">{ONLINE.length}</span> online
        </span>
      </Pill>
      <Pill
        label={`In voice: ${LIVE_ROOMS.map((r) => `${r.name} (${server(r.serverId)?.name})`).join(", ")}`}
        onClick={onLive}
      >
        <Headphones className="size-3.5" />
        <span>
          <span className="text-foreground">{IN_VOICE.length}</span> in voice
        </span>
      </Pill>
      <span className="mx-1 h-4 w-px bg-surface-3" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
            className={cn(
              "relative grid size-7 place-items-center rounded-lg transition-colors",
              open
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Bell
              className={cn(
                "size-4",
                unread > 0 && "origin-top animate-[wiggle_1.2s_ease-in-out_1]",
              )}
            />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full border-2 border-ink bg-danger-fill px-0.5 text-[9px] leading-none font-bold text-white">
                {unread}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[380px] max-w-[calc(100vw-1rem)] p-0"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button
              type="button"
              onClick={() => setRead(new Set(NOTES.map((n) => n.id)))}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-1.5">
            <div className="flex gap-1 p-1">
              {(["all", "unread", "mentions"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "h-7 rounded-md px-2.5 text-xs capitalize",
                    filter === f ? "bg-accent" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            {shown.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No notifications.</p>
            )}
            {shown.map((n) => {
              const isUnread = !read.has(n.id);
              return (
                <div
                  key={n.id}
                  className="relative flex w-full items-start gap-3 rounded-lg p-2.5 text-left hover:bg-accent/60"
                >
                  <button
                    type="button"
                    aria-label={`Open notification from ${FRIENDS.find((f) => f.id === n.who)?.name}`}
                    className="absolute inset-0 rounded-lg"
                    onClick={() => {
                      setRead((r) => new Set(r).add(n.id));
                      if (n.open) {
                        onOpen(n.open);
                        setOpen(false);
                      }
                    }}
                  />
                  <span className="relative">
                    <Avatar id={n.who} size={36} />
                    <span className="absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full border-2 border-popover bg-surface-3 text-foreground">
                      {n.kind === "request" ? (
                        <UserPlus className="size-2.5" />
                      ) : (
                        <AtSign className="size-2.5" />
                      )}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[13px]">
                        <b className="font-semibold">{FRIENDS.find((f) => f.id === n.who)?.name}</b>
                        <span className="text-muted-foreground">
                          {n.kind === "request" ? ` ${n.text}` : n.where ? ` in ${n.where}` : ""}
                        </span>
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {n.at}
                      </span>
                    </span>
                    {n.kind !== "request" && (
                      <span className="mt-0.5 block truncate text-[13px] text-foreground/80">
                        <EmojiText text={n.text} size={15} />
                      </span>
                    )}
                    {n.kind === "request" && request !== "pending" && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {request === "accepted" ? "You're now friends" : "Request ignored"}
                      </span>
                    )}
                    {n.kind === "request" && request === "pending" && (
                      <span className="relative mt-2 flex w-fit gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            answerRequest("rui", true);
                            setRead((r) => new Set(r).add(n.id));
                          }}
                          className="rounded-md bg-brand-fill px-2.5 py-1 text-xs font-semibold text-white"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            answerRequest("rui", false);
                            setRead((r) => new Set(r).add(n.id));
                          }}
                          className="rounded-md bg-surface-3 px-2.5 py-1 text-xs font-medium"
                        >
                          Ignore
                        </button>
                      </span>
                    )}
                  </span>
                  {isUnread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />}
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
