import { ChevronDown, Compass, Hash, Inbox, Plus, Search, UserRound, Volume2 } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/Avatar";
import { AdeptMark } from "@/components/brand/AdeptMark";
import { ServerIcon } from "@/components/ServerIcon";
import { ChatView } from "@/features/chat/ChatView";
import { activityText } from "@/features/shell/activityText";
import { MemberList } from "@/features/shell/MemberList";
import { UserBar } from "@/features/shell/UserBar";
import { cn } from "@/lib/utils";
import { conversation, CONVERSATIONS, type Server, SERVERS, user } from "@/mock/data";

function RailItem({
  active,
  unread,
  mentions,
  label,
  onClick,
  children,
}: {
  active: boolean;
  unread?: boolean;
  mentions?: number;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex w-full justify-center">
      <span
        className={cn(
          "absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-all duration-200",
          active ? "h-10" : unread ? "h-2 group-hover:h-5" : "h-0 group-hover:h-5",
        )}
      />
      <button type="button" aria-label={label} title={label} onClick={onClick} className="relative">
        {children}
        {mentions ? (
          <span className="absolute -right-1 -bottom-1 grid h-5 min-w-5 place-items-center rounded-full border-[3px] border-ink bg-destructive px-1 text-[10px] font-bold text-white">
            {mentions}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function serverUnread(s: Server) {
  return s.channels.some((c) => (c.unread ?? 0) > 0);
}
function serverMentions(s: Server) {
  return s.channels.reduce((n, c) => n + (c.mentions ?? 0), 0);
}

function HomeSidebar({ active, onOpen }: { active: string; onOpen: (id: string) => void }) {
  const dms = CONVERSATIONS.filter((c) => c.kind !== "channel");
  return (
    <>
      <div className="flex h-14 shrink-0 items-center border-b border-border px-2.5">
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md bg-ink/60 px-2.5 text-[13px] text-muted-foreground"
        >
          <Search className="size-3.5" />
          Find or start a conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {[
          { icon: UserRound, label: "Friends" },
          { icon: Inbox, label: "Message requests" },
        ].map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            className="flex h-10 w-full items-center gap-3 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
        <div className="mt-4 mb-1 flex items-center justify-between px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Direct messages
          <Plus className="size-4 cursor-pointer hover:text-foreground" />
        </div>
        {dms.map((c) => {
          const u = user(c.members[0] ?? "");
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(c.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
                active === c.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {c.kind === "group" ? (
                <span className="grid size-8 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-foreground">
                  {c.members.length + 1}
                </span>
              ) : (
                <Avatar id={u.id} size={32} status ringBg="var(--surface-1)" />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-sm",
                    c.unread > 0 ? "font-semibold text-foreground" : "font-medium",
                  )}
                >
                  {c.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {c.kind === "group"
                    ? `${c.members.length + 1} members`
                    : u.activity
                      ? activityText(u.activity)
                      : ""}
                </span>
              </span>
              {c.unread > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                  {c.unread}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function ServerSidebar({
  s,
  active,
  onOpen,
}: {
  s: Server;
  active: string;
  onOpen: (id: string) => void;
}) {
  const categories = [...new Set(s.channels.map((c) => c.category))];
  return (
    <>
      <button
        type="button"
        className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 text-left font-semibold hover:bg-accent/40"
      >
        <span className="truncate">{s.name}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {categories.map((cat) => (
          <div key={cat} className="mb-4">
            <p className="mb-1 flex items-center gap-1 px-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <ChevronDown className="size-3" />
              {cat}
            </p>
            {s.channels
              .filter((c) => c.category === cat)
              .map((c) => (
                <div key={c.id}>
                  <button
                    type="button"
                    onClick={() => c.kind === "text" && onOpen(c.id)}
                    className={cn(
                      "group relative flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-[15px]",
                      active === c.id
                        ? "bg-accent text-foreground"
                        : c.unread
                          ? "font-semibold text-foreground hover:bg-accent/60"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {c.unread && active !== c.id ? (
                      <span className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground" />
                    ) : null}
                    {c.kind === "text" ? (
                      <Hash className="size-[18px] shrink-0 opacity-70" />
                    ) : (
                      <Volume2 className="size-[18px] shrink-0 opacity-70" />
                    )}
                    <span className="truncate">{c.name}</span>
                    {c.mentions ? (
                      <span className="ml-auto grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                        {c.mentions}
                      </span>
                    ) : null}
                  </button>
                  {c.voice?.map((id) => (
                    <div
                      key={id}
                      className="flex h-7 items-center gap-2 pl-8 text-sm text-muted-foreground"
                    >
                      <Avatar id={id} size={20} />
                      <span className="truncate">{user(id).name}</span>
                      {c.live === id && (
                        <span className="ml-auto mr-2 rounded bg-destructive px-1 text-[9px] font-bold tracking-wide text-white">
                          LIVE
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        ))}
      </div>
    </>
  );
}

export function ClassicLayout() {
  const [place, setPlace] = useState<string>("home");
  const [open, setOpen] = useState<Record<string, string>>({
    home: "dm-maya",
    ...Object.fromEntries(SERVERS.map((s) => [s.id, s.channels[0]?.id ?? ""])),
    owls: "owls-general",
  });
  const [membersOpen, setMembersOpen] = useState(true);
  const s = SERVERS.find((x) => x.id === place);
  const activeId = open[place] ?? "dm-maya";
  const c = conversation(activeId);

  return (
    <div className="flex h-full">
      <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-ink py-3">
        <RailItem active={place === "home"} label="Home" onClick={() => setPlace("home")}>
          <span
            className={cn(
              "grid size-12 place-items-center transition-all duration-200",
              place === "home"
                ? "rounded-[30%] bg-brand"
                : "rounded-[38%] bg-surface-2 hover:bg-brand/80",
            )}
          >
            <AdeptMark
              tone={place === "home" ? "mono" : "brand"}
              className={cn("size-7", place === "home" && "text-white")}
            />
          </span>
        </RailItem>
        <span className="h-0.5 w-8 rounded-full bg-surface-3" />
        {SERVERS.map((srv) => (
          <RailItem
            key={srv.id}
            label={srv.name}
            active={place === srv.id}
            unread={serverUnread(srv)}
            mentions={serverMentions(srv)}
            onClick={() => setPlace(srv.id)}
          >
            <ServerIcon server={srv} active={place === srv.id} />
          </RailItem>
        ))}
        <span className="grid size-12 place-items-center rounded-[38%] bg-surface-2 text-success transition-colors hover:bg-success hover:text-white">
          <Plus className="size-5" />
        </span>
        <span className="grid size-12 place-items-center rounded-[38%] bg-surface-2 text-muted-foreground transition-colors hover:bg-brand hover:text-white">
          <Compass className="size-5" />
        </span>
      </nav>

      <aside className="flex w-60 shrink-0 flex-col bg-surface-1">
        {s ? (
          <ServerSidebar
            s={s}
            active={activeId}
            onOpen={(id) => setOpen((o) => ({ ...o, [place]: id }))}
          />
        ) : (
          <HomeSidebar active={activeId} onOpen={(id) => setOpen((o) => ({ ...o, home: id }))} />
        )}
        <UserBar />
      </aside>

      <ChatView
        key={activeId}
        conversationId={activeId}
        membersOpen={membersOpen}
        onToggleMembers={() => setMembersOpen((v) => !v)}
      />
      {membersOpen && c.kind !== "dm" && <MemberList ids={c.members} />}
    </div>
  );
}
