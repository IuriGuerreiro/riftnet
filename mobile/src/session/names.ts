import { ConversationKind, type Conversation } from '@shared/gen/v1/conversations_pb';
import { useChat } from '@shared/stores/chat';

// Display helpers shared by the DM list, chat and call screens.
export const isGroup = (c: Conversation) => c.kind === ConversationKind.GROUP;

export function conversationTitle(c: Conversation, myId: bigint | undefined) {
  if (isGroup(c)) return c.name || 'Group';
  const other = c.members.find(m => m.id !== myId) ?? c.members[0];
  return other ? `@${other.username}` : 'DM';
}

/** Username for a user id, from the members of conversations we know. */
export function usernameOf(id: bigint): string {
  for (const c of useChat.getState().conversations) {
    const m = c.members.find(x => x.id === id);
    if (m) return m.username;
  }
  return 'someone';
}
