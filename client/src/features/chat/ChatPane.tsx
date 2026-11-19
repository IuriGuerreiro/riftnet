import { isGroup, useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { useTyping } from "../../stores/typing";
import { Composer } from "../composer/Composer";
import { GroupHeader } from "../groups/GroupHeader";
import { DmHeader } from "./DmHeader";
import { MessageList } from "./MessageList";
import { TypingIndicator } from "./TypingIndicator";

export function ChatPane() {
  const { ws, user: me } = useConnection();
  const chat = useChat();
  const selected = chat.conversations.find((c) => c.id === chat.selected);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {selected ? (
        <>
          {isGroup(selected) ? (
            <GroupHeader
              group={selected}
              onAdd={(username) => ws && chat.addMember(ws, username)}
              onRename={(name) => ws && chat.renameGroup(ws, name)}
              onLeave={() => ws && chat.leaveGroup(ws)}
            />
          ) : (
            <DmHeader conversation={selected} />
          )}
          <MessageList conversationId={selected.id} myId={me?.id} />
          <TypingIndicator conversation={selected} />
          <Composer
            conversationId={selected.id}
            disabled={!ws}
            onType={() => ws && useTyping.getState().typed(ws, selected.id)}
            onSend={(text, ids) => ws && me && chat.send(ws, me.id, text, ids)}
          />
        </>
      ) : (
        <p className="m-auto text-sm text-zinc-500">
          Pick a conversation, or start a DM or a group.
        </p>
      )}
      {chat.error && <p className="px-4 pb-2 text-xs text-red-400">{chat.error}</p>}
    </section>
  );
}
