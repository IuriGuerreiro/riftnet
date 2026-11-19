import type { Conversation } from "../../gen/v1/conversations_pb";
import { nameOf, useProfiles } from "../../stores/profiles";
import { typingText, useTyping } from "../../stores/typing";

export function TypingIndicator({ conversation }: { conversation: Conversation }) {
  const typing = useTyping((s) => s.typing[conversation.id.toString()]);
  const profiles = useProfiles((s) => s.byId);
  const names = Object.keys(typing ?? {}).map((id) => nameOf(profiles[id]));
  return <p className="h-5 truncate px-4 text-xs italic text-zinc-400">{typingText(names)}</p>;
}
