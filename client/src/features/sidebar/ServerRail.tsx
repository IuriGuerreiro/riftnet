import { MessageCircle, Plus } from "lucide-react";

import { Tooltip } from "../../components/ui";
import { cn } from "../../components/ui/cn";
import { useChat } from "../../stores/chat";
import { useFriends } from "../../stores/friends";

const pill =
  "flex size-12 items-center justify-center rounded-3xl transition-all duration-150 hover:rounded-2xl";

export function ServerRail({ onCreateGroup }: { onCreateGroup: () => void }) {
  const unread = useChat((s) =>
    s.conversations.reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), 0),
  );
  const pending = useFriends((s) => s.list.incoming.length);
  const alert = unread + pending > 0;

  return (
    <nav
      aria-label="Servers"
      className="hidden w-[72px] shrink-0 flex-col items-center gap-2 bg-surface-0 py-3 sm:flex"
    >
      <Tooltip content="Direct messages" side="right">
        <span className="relative flex">
          <span className="absolute -left-3 top-1/2 h-10 w-1 -translate-y-1/2 rounded-r bg-fg" />
          <span className={cn(pill, "rounded-2xl bg-brand text-on-brand")}>
            <MessageCircle size={26} />
          </span>
          {alert && (
            <span className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full border-4 border-surface-0 bg-danger" />
          )}
        </span>
      </Tooltip>
      <span className="h-0.5 w-8 rounded bg-surface-3" />
      <Tooltip content="Create group" side="right">
        <button
          type="button"
          aria-label="Create group"
          onClick={onCreateGroup}
          className={cn(pill, "bg-surface-2 text-success hover:bg-success hover:text-surface-0")}
        >
          <Plus size={24} />
        </button>
      </Tooltip>
    </nav>
  );
}
