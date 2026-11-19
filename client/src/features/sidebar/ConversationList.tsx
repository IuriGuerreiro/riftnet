import { Avatar } from "../../components/Avatar";
import { StatusDot } from "../../components/StatusDot";
import { isGroup, useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { useNameFor } from "../session/useRealtime";
import { otherMember } from "./conversation";

export function ConversationList() {
  const { ws, user: me } = useConnection();
  const { conversations, selected, select } = useChat();
  const nameFor = useNameFor();

  return (
    <nav className="flex-1 overflow-y-auto">
      {conversations.map((c) => {
        const other = otherMember(c, me?.id);
        return (
          <button
            key={c.id.toString()}
            onClick={() => ws && select(ws, c.id)}
            className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-zinc-800 ${c.id === selected ? "bg-zinc-800 text-brand" : ""}`}
          >
            {!isGroup(c) && <Avatar userId={other?.id} size="xs" />}
            {!isGroup(c) && <StatusDot userId={other?.id} />}
            <span className="truncate">{isGroup(c) ? `# ${c.name}` : nameFor(other?.id)}</span>
            {c.unreadCount > 0 && c.id !== selected && (
              <span className="ml-auto rounded-full bg-brand px-1.5 text-xs font-semibold text-white">
                {c.unreadCount >= 10 ? "9+" : c.unreadCount}
              </span>
            )}
          </button>
        );
      })}
      {conversations.length === 0 && (
        <p className="p-4 text-xs text-zinc-500">No conversations yet.</p>
      )}
    </nav>
  );
}
