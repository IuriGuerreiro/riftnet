import type { Conversation } from "../../gen/v1/conversations_pb";
import { nameOf, useProfiles } from "../../stores/profiles";
import { typingText, useTyping } from "../../stores/typing";

export function TypingIndicator({ conversation }: { conversation: Conversation }) {
  const typing = useTyping((s) => s.typing[conversation.id.toString()]);
  const profiles = useProfiles((s) => s.byId);
  const names = Object.keys(typing ?? {}).map((id) => nameOf(profiles[id]));
  return (
    <p className="h-6 shrink-0 truncate px-4 text-xs leading-6 text-fg-muted">
      {typingText(names)}
    </p>
  );
}
