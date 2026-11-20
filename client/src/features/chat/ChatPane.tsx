import { isGroup, useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { useTyping } from "../../stores/typing";
import { useUi } from "../../stores/ui";
import { Composer } from "../composer/Composer";
import { MemberList } from "../members/MemberList";
import { useNameFor } from "../session/useRealtime";
import { otherMember } from "../sidebar/conversation";
import { ChatHeader } from "./ChatHeader";
import { ChatIntro } from "./ChatIntro";
import { MessageList } from "./MessageList";
import { TypingIndicator } from "./TypingIndicator";

export function ChatPane() {
  const { ws, user: me } = useConnection();
  const chat = useChat();
  const membersOpen = useUi((s) => s.membersOpen);
  const nameFor = useNameFor();
  const selected = chat.conversations.find((c) => c.id === chat.selected);

  if (!selected) {
    return (
      <section className="flex flex-1 items-center justify-center bg-surface-2 p-8 text-center text-sm text-fg-subtle">
        Select a conversation, or start a direct message or group.
      </section>
    );
  }

  const group = isGroup(selected);
  const placeholder = group
    ? `Message #${selected.name}`
    : `Message @${nameFor(otherMember(selected, me?.id)?.id)}`;

  return (
    <div className="flex min-w-0 flex-1 bg-surface-2">
      <section className="flex min-w-0 flex-1 flex-col">
        <ChatHeader conversation={selected} />
        {chat.error && (
          <div
            role="alert"
            className="flex items-center gap-2 bg-danger/15 px-4 py-2 text-sm text-danger"
          >
            <span className="flex-1">{chat.error}</span>
          </div>
        )}
        <MessageList
          conversationId={selected.id}
          myId={me?.id}
          intro={<ChatIntro conversation={selected} />}
        />
        <Composer
          conversationId={selected.id}
          placeholder={placeholder}
          disabled={!ws}
          onType={() => ws && useTyping.getState().typed(ws, selected.id)}
          onSend={(text, ids) => ws && me && chat.send(ws, me.id, text, ids)}
        />
        <TypingIndicator conversation={selected} />
      </section>
      {group && membersOpen && <MemberList group={selected} />}
    </div>
  );
}
