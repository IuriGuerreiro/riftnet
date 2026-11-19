import { X } from "lucide-react";

import { IconButton } from "../../components/ui";
import { useChat } from "../../stores/chat";
import { nameOf, useProfiles } from "../../stores/profiles";

export function ReplyBar({ conversationId }: { conversationId: bigint }) {
  const replyingTo = useChat((s) => s.replyingTo);
  const message = useChat((s) =>
    s.messages[conversationId.toString()]?.find((m) => m.id === s.replyingTo),
  );
  const setReplyingTo = useChat((s) => s.setReplyingTo);
  const profiles = useProfiles((s) => s.byId);
  if (replyingTo === null || !message) return null;
  return (
    <div className="flex items-center gap-2 rounded-control bg-surface-2 px-2 py-1 text-xs text-fg-muted">
      <span className="min-w-0 flex-1 truncate">
        Replying to{" "}
        <span className="font-semibold text-fg">
          {nameOf(profiles[message.authorId.toString()])}
        </span>
        : {message.text || "📎 attachment"}
      </span>
      <IconButton
        label="Cancel reply (Esc)"
        size="sm"
        tone="danger"
        icon={<X size={14} />}
        onClick={() => setReplyingTo(null)}
        className="size-5"
      />
    </div>
  );
}
