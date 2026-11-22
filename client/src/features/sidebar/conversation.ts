import type { Conversation } from "../../gen/v1/conversations_pb";

export const otherMember = (c: Conversation, myId: bigint | undefined) =>
  c.members.find((m) => m.id !== myId) ?? c.members[0];
