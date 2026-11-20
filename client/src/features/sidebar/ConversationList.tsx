import { Hash, MessageSquarePlus, Users } from "lucide-react";

import { AvatarWithStatus } from "../../components/AvatarWithStatus";
import { Badge, countLabel, Menu, Skeleton } from "../../components/ui";
import { cn } from "../../components/ui/cn";
import { isGroup, useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { useUi } from "../../stores/ui";
import { useNameFor } from "../session/useRealtime";
import { otherMember } from "./conversation";
import type { NewConversation } from "./NewConversationDialogs";

export function ConversationList({ onNew }: { onNew: (kind: NewConversation) => void }) {
  const { ws, user: me, status } = useConnection();
  const { conversations, selected, select } = useChat();
  const { view, showChat } = useUi();
  const nameFor = useNameFor();
  const loading = status === "connecting" && conversations.length === 0;

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2">
      <div className="flex items-center justify-between px-2 pb-1 pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg-muted">
          Direct messages
        </h2>
        <Menu
          trigger={({ open, toggle }) => (
            <button
              type="button"
              aria-label="Create DM or group"
              title="Create DM or group"
              aria-expanded={open}
              onClick={toggle}
              className="text-lg leading-none text-fg-subtle hover:text-fg"
            >
              +
            </button>
          )}
          items={[
            {
              label: "New message",
              icon: <MessageSquarePlus size={16} />,
              onSelect: () => onNew("dm"),
            },
            { label: "Create group", icon: <Users size={16} />, onSelect: () => onNew("group") },
          ]}
        />
      </div>

      {loading &&
        Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-1.5">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}

      <ul className="space-y-0.5">
        {conversations.map((c) => {
          const other = otherMember(c, me?.id);
          const active = view === "chat" && c.id === selected;
          const unread = c.unreadCount > 0 && !active;
          return (
            <li key={c.id.toString()}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  showChat();
                  if (ws) void select(ws, c.id);
                }}
                className={cn(
                  "group relative flex w-full items-center gap-3 rounded-control px-2 py-1.5 text-left transition-colors",
                  active
                    ? "bg-surface-4 text-fg"
                    : unread
                      ? "text-fg hover:bg-surface-3"
                      : "text-fg-subtle hover:bg-surface-3 hover:text-fg-muted",
                )}
              >
                {unread && <span className="absolute -left-2 h-2 w-1 rounded-r bg-fg" />}
                {isGroup(c) ? (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand">
                    <Hash size={16} />
                  </span>
                ) : (
                  <AvatarWithStatus userId={other?.id} />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[15px]",
                      (unread || active) && "font-semibold",
                    )}
                  >
                    {isGroup(c) ? c.name : nameFor(other?.id)}
                  </span>
                  {isGroup(c) && (
                    <span className="block truncate text-xs text-fg-subtle">
                      {c.members.length} members
                    </span>
                  )}
                </span>
                {unread && <Badge>{countLabel(c.unreadCount)}</Badge>}
              </button>
            </li>
          );
        })}
      </ul>

      {!loading && conversations.length === 0 && (
        <p className="px-2 py-4 text-center text-xs text-fg-subtle">
          No conversations yet. Press + to start one.
        </p>
      )}
    </div>
  );
}
