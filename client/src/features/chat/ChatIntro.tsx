import { Hash } from "lucide-react";

import { Avatar } from "../../components/Avatar";
import type { Conversation } from "../../gen/v1/conversations_pb";
import { isGroup } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { useNameFor } from "../session/useRealtime";
import { otherMember } from "../sidebar/conversation";

export function ChatIntro({ conversation: c }: { conversation: Conversation }) {
  const me = useConnection((s) => s.user);
  const nameFor = useNameFor();
  if (isGroup(c)) {
    return (
      <div className="space-y-2">
        <span className="flex size-16 items-center justify-center rounded-full bg-surface-3">
          <Hash size={36} className="text-fg" />
        </span>
        <h2 className="text-3xl font-bold text-fg">Welcome to #{c.name}!</h2>
        <p className="text-fg-muted">This is the start of the #{c.name} group.</p>
      </div>
    );
  }
  const other = otherMember(c, me?.id);
  return (
    <div className="space-y-2">
      <span className="block [&>*]:size-20! [&>*]:text-3xl">
        <Avatar userId={other?.id} size="lg" />
      </span>
      <h2 className="text-3xl font-bold text-fg">{nameFor(other?.id)}</h2>
      <p className="text-fg-muted">
        This is the beginning of your direct message history with{" "}
        <strong className="text-fg">{nameFor(other?.id)}</strong>.
      </p>
    </div>
  );
}
