import { CallBar } from "../../call/CallBar";
import { Avatar } from "../../components/Avatar";
import { StatusDot } from "../../components/StatusDot";
import type { Conversation } from "../../gen/v1/conversations_pb";
import { useConnection } from "../../stores/connection";
import { useNameFor } from "../session/useRealtime";
import { otherMember } from "../sidebar/conversation";

export function DmHeader({ conversation }: { conversation: Conversation }) {
  const { ws, user: me } = useConnection();
  const nameFor = useNameFor();
  const other = otherMember(conversation, me?.id);
  return (
    <header className="flex items-center justify-between border-b border-zinc-800 p-4 font-semibold">
      <span className="flex items-center gap-2">
        <Avatar userId={other?.id} />
        <StatusDot userId={other?.id} />
        {nameFor(other?.id)}
      </span>
      <CallBar ws={ws} conversationId={conversation.id} />
    </header>
  );
}
