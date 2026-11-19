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
    <div className="flex items-center gap-2 rounded bg-zinc-800/60 px-2 py-1 text-xs text-zinc-400">
      <span className="min-w-0 flex-1 truncate">
        Replying to{" "}
        <span className="font-semibold text-zinc-200">
          {nameOf(profiles[message.authorId.toString()])}
        </span>
        : {message.text || "📎 attachment"}
      </span>
      <button
        type="button"
        title="Cancel reply (Esc)"
        onClick={() => setReplyingTo(null)}
        className="hover:text-red-400"
      >
        ✕
      </button>
    </div>
  );
}
