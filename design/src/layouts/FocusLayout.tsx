import { Hash, MessageSquare, Plus, Search, Settings, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { AdeptMark } from "@/components/brand/AdeptMark";
import { ChatView } from "@/features/chat/ChatView";
import { JumpPalette } from "@/features/shell/JumpPalette";
import { MemberList } from "@/features/shell/MemberList";
import { cn } from "@/lib/utils";
import { conversation, ME } from "@/mock/data";

function Tab({
  id,
  active,
  onSelect,
  onClose,
}: {
  id: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const c = conversation(id);
  return (
    <div
      className={cn(
        "group relative flex h-9 max-w-52 min-w-32 items-center gap-2 rounded-t-lg pr-1.5 pl-3 text-sm transition-colors",
        active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {c.kind === "channel" ? (
          <Hash className="size-3.5 shrink-0 opacity-70" />
        ) : (
          <Avatar id={c.members[0] ?? ""} size={18} />
        )}
        <span className="truncate">{c.title}</span>
        {!active && c.unread > 0 && <span className="size-1.5 shrink-0 rounded-full bg-brand" />}
      </button>
      <button
        type="button"
        aria-label={`Close ${c.title}`}
        onClick={onClose}
        className={cn(
          "grid size-5 place-items-center rounded hover:bg-surface-4",
          !active && "opacity-0 group-hover:opacity-100",
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid size-10 place-items-center rounded-xl transition-colors",
        active
          ? "bg-surface-3 text-foreground"
          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function FocusLayout() {
  const [tabs, setTabs] = useState(["dm-maya", "owls-general", "group-trip"]);
  const [active, setActive] = useState("dm-maya");
  const [palette, setPalette] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = (id: string) => {
    setTabs((t) => (t.includes(id) ? t : [...t, id]));
    setActive(id);
    setPalette(false);
  };
  const close = (id: string) => {
    const next = tabs.filter((t) => t !== id);
    setTabs(next);
    if (active === id) setActive(next.at(-1) ?? "");
  };
  const c = active ? conversation(active) : null;

  return (
    <div className="flex h-full bg-ink">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-1.5 py-3">
        <AdeptMark className="mb-3 size-8" />
        <RailButton label="Chats" active>
          <MessageSquare className="size-5" />
        </RailButton>
        <RailButton label="Friends">
          <UserRound className="size-5" />
        </RailButton>
        <RailButton label="Jump to… (⌘K)" onClick={() => setPalette(true)}>
          <Search className="size-5" />
        </RailButton>
        <div className="mt-auto flex flex-col items-center gap-2">
          <RailButton label="Settings">
            <Settings className="size-5" />
          </RailButton>
          <Avatar id={ME} size={34} status ringBg="var(--adept-ink)" />
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col py-2 pr-2">
        <div className="flex h-11 shrink-0 items-end gap-0.5 overflow-x-auto pr-2">
          {tabs.map((id) => (
            <Tab
              key={id}
              id={id}
              active={id === active}
              onSelect={() => setActive(id)}
              onClose={() => close(id)}
            />
          ))}
          <button
            type="button"
            aria-label="Open conversation"
            onClick={() => setPalette(true)}
            className="mb-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="mb-1 ml-auto flex h-7 shrink-0 items-center gap-2 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Search className="size-3.5" />
            Jump to…
            <kbd className="rounded bg-surface-3 px-1 text-[10px]">⌘K</kbd>
          </button>
        </div>
        <div
          className={cn(
            "flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background",
            tabs.at(0) === active && "rounded-tl-none",
          )}
        >
          {c ? (
            <>
              <ChatView
                key={active}
                conversationId={active}
                lane="center"
                membersOpen={membersOpen}
                onToggleMembers={() => setMembersOpen((v) => !v)}
              />
              {membersOpen && c.kind !== "dm" && <MemberList ids={c.members} />}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <AdeptMark tone="mono" className="size-10 text-surface-4" />
              <p className="text-sm text-muted-foreground">No conversation open</p>
              <button
                type="button"
                onClick={() => setPalette(true)}
                className="text-sm font-medium text-brand hover:underline"
              >
                Jump to something (⌘K)
              </button>
            </div>
          )}
        </div>
      </div>

      <JumpPalette open={palette} onOpenChange={setPalette} onOpen={open} />
    </div>
  );
}
