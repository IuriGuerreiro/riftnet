import { useEffect, useRef } from "react";

import { useChat } from "../../stores/chat";
import { MessageRow } from "./MessageRow";

export function MessageList({ conversationId, myId }: { conversationId: bigint; myId?: bigint }) {
  const messages = useChat((s) => s.messages[conversationId.toString()]) ?? [];
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView();
  }, [messages.length]);

  return (
    <div className="flex-1 space-y-1 overflow-y-auto p-4">
      {messages.map((m) => (
        <MessageRow
          key={m.nonce ?? m.id.toString()}
          m={m}
          mine={m.authorId === myId}
          conversationId={conversationId}
        />
      ))}
      <div ref={bottom} />
    </div>
  );
}
