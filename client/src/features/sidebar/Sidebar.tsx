import { useSearch } from "@tanstack/react-router";
import { Users } from "lucide-react";

import { Badge } from "../../components/ui";
import { cn } from "../../components/ui/cn";
import { readWorkspaceSearch } from "../../schemas/workspace";
import { useFriends } from "../../stores/friends";
import { useUi } from "../../stores/ui";
import { ServerSidebar } from "../servers/ServerSidebar";
import { ConversationList } from "./ConversationList";
import type { NewConversation } from "./NewConversationDialogs";
import { UserPanel } from "./UserPanel";

export function Sidebar({
  onEditProfile,
  onNew,
}: {
  onEditProfile: () => void;
  onNew: (kind: NewConversation) => void;
}) {
  const pending = useFriends((s) => s.list.incoming.length);
  const { view, showFriends } = useUi();
  const { server, channel } = useSearch({ from: "__root__", select: readWorkspaceSearch });

  if (server)
    return (
      <aside className="flex w-60 shrink-0 flex-col bg-surface-1">
        <ServerSidebar key={server} serverId={server} channelId={channel} />
        <UserPanel onEditProfile={onEditProfile} />
      </aside>
    );

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-surface-1">
      <div className="flex h-12 shrink-0 items-center border-b border-surface-0 px-2.5 shadow-sm">
        <button
          type="button"
          onClick={() => onNew("dm")}
          className="h-7 w-full rounded-md bg-surface-0 px-2 text-left text-sm text-fg-subtle hover:text-fg-muted"
        >
          Find or start a conversation
        </button>
      </div>
      <div className="px-2 pt-2">
        <button
          type="button"
          aria-current={view === "friends" ? "page" : undefined}
          onClick={showFriends}
          className={cn(
            "flex h-10 w-full items-center gap-3 rounded-control px-3 text-[15px] font-medium transition-colors",
            view === "friends"
              ? "bg-surface-4 text-fg"
              : "text-fg-muted hover:bg-surface-3 hover:text-fg",
          )}
        >
          <Users size={20} />
          <span className="flex-1 text-left">Friends</span>
          {pending > 0 && <Badge>{pending}</Badge>}
        </button>
      </div>
      <ConversationList onNew={onNew} />
      <UserPanel onEditProfile={onEditProfile} />
    </aside>
  );
}
