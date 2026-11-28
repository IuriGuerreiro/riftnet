import { ArrowLeft, Hash, Pin, Search, SquarePen, Volume2 } from "lucide-react";
import { useState } from "react";

import { RiftnetMark } from "@/components/brand/RiftnetMark";
import { ServerIcon } from "@/components/ServerIcon";
import { ChatView } from "@/features/chat/ChatView";
import { ConversationRow } from "@/features/shell/ConversationRow";
import { MemberList } from "@/features/shell/MemberList";
import { UserBar } from "@/features/shell/UserBar";
import { cn } from "@/lib/utils";
import { type Conversation, conversation, CONVERSATIONS, type Server, SERVERS } from "@/mock/data";

const FILTERS = ["All", "Unread", "Mentions", "People", "Servers"] as const;
type Filter = (typeof FILTERS)[number];

function matches(c: Conversation, f: Filter) {
  switch (f) {
    case "Unread":
      return c.unread > 0;
    case "Mentions":
      return c.mentions > 0;
    case "People":
      return c.kind !== "channel";
    case "Servers":
      return c.kind === "channel";
    default:
      return true;
  }
}

function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
      {icon}
      {children}
    </p>
  );
}

function ServerChannels({
  s,
  active,
  onOpen,
}: {
  s: Server;
  active: string;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      {[...new Set(s.channels.map((c) => c.category))].map((cat) => (
        <div key={cat}>
          <SectionLabel>{cat}</SectionLabel>
          {s.channels
            .filter((c) => c.category === cat)
            .map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => ch.kind === "text" && onOpen(ch.id)}
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm",
                  active === ch.id
                    ? "bg-accent font-semibold"
                    : ch.unread
                      ? "font-semibold hover:bg-accent/60"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {ch.kind === "text" ? (
                  <Hash className="size-4 opacity-70" />
                ) : (
                  <Volume2 className="size-4 opacity-70" />
                )}
                <span className="truncate">{ch.name}</span>
                {ch.kind === "voice" && (ch.voice?.length ?? 0) > 0 && (
                  <span className="ml-auto text-xs text-success">{ch.voice?.length} in voice</span>
                )}
                {ch.unread ? (
                  <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-fill px-1.5 text-[11px] font-bold text-white">
                    {ch.unread}
                  </span>
                ) : null}
              </button>
            ))}
        </div>
      ))}
    </>
  );
}

export function InboxLayout() {
  const [filter, setFilter] = useState<Filter>("All");
  const [active, setActive] = useState("dm-maya");
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const c = conversation(active);
  const srv = SERVERS.find((s) => s.id === browsing);

  const list = CONVERSATIONS.filter((x) => matches(x, filter)).sort((a, b) => a.rank - b.rank);
  const pinned = list.filter((x) => x.pinned);
  const recent = list.filter((x) => !x.pinned);

  return (
    <div className="flex h-full">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-border bg-surface-1">
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
          {srv ? (
            <button
              type="button"
              aria-label="Back to inbox"
              onClick={() => setBrowsing(null)}
              className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : (
            <RiftnetMark className="size-6" />
          )}
          <h1 className="flex-1 truncate text-lg font-semibold">{srv ? srv.name : "Inbox"}</h1>
          <button
            type="button"
            aria-label="New message"
            title="New message"
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <SquarePen className="size-[18px]" />
          </button>
        </div>

        <div className="px-3">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground focus-within:border-brand/50">
            <Search className="size-4" />
            <input
              placeholder="Search or jump to…"
              className="flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border border-border px-1.5 text-[10px]">⌘K</kbd>
          </label>
        </div>

        {!srv && (
          <div className="flex gap-1.5 overflow-x-auto px-3 pt-3 pb-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "h-7 shrink-0 rounded-full px-3 text-xs font-medium transition-colors",
                  filter === f
                    ? "bg-foreground text-background"
                    : "bg-surface-3 text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {srv ? (
            <ServerChannels s={srv} active={active} onOpen={setActive} />
          ) : (
            <>
              {pinned.length > 0 && (
                <SectionLabel icon={<Pin className="size-3" />}>Pinned</SectionLabel>
              )}
              {pinned.map((x) => (
                <ConversationRow
                  key={x.id}
                  c={x}
                  active={active === x.id}
                  onClick={() => setActive(x.id)}
                />
              ))}
              {recent.length > 0 && <SectionLabel>Recent</SectionLabel>}
              {recent.map((x) => (
                <ConversationRow
                  key={x.id}
                  c={x}
                  active={active === x.id}
                  onClick={() => setActive(x.id)}
                />
              ))}
              {list.length === 0 && (
                <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                  You're all caught up ✨
                </p>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border px-3 pt-2.5 pb-1">
          <p className="pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Servers
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1.5">
            {SERVERS.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.name}
                onClick={() => setBrowsing(s.id)}
                className={cn(
                  "rounded-[38%] ring-2 ring-offset-2 ring-offset-surface-1 transition-shadow",
                  browsing === s.id ? "ring-brand" : "ring-transparent hover:ring-surface-4",
                )}
              >
                <ServerIcon server={s} size={36} />
              </button>
            ))}
          </div>
        </div>
        <UserBar />
      </aside>

      <ChatView
        key={active}
        conversationId={active}
        membersOpen={membersOpen}
        onToggleMembers={() => setMembersOpen((v) => !v)}
      />
      {membersOpen && c.kind !== "dm" && <MemberList ids={c.members} />}
    </div>
  );
}
