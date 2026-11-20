import { sameDay, snowflakeTime } from "../../lib/time";
import type { ChatMessage } from "../../stores/chat";

const GROUP_WINDOW_MS = 7 * 60_000;

export interface MessageLayout {
  message: ChatMessage;
  time: Date;
  header: boolean;
  dayDivider: boolean;
}

function startsGroup(
  prev: { message: ChatMessage; time: Date } | undefined,
  message: ChatMessage,
  time: Date,
): boolean {
  if (!prev || !sameDay(prev.time, time)) return true;
  if (prev.message.authorId !== message.authorId) return true;
  if (time.getTime() - prev.time.getTime() > GROUP_WINDOW_MS) return true;
  return message.replyTo !== undefined;
}

export function groupMessages(messages: ChatMessage[]): MessageLayout[] {
  let prev: { message: ChatMessage; time: Date } | undefined;
  return messages.map((message) => {
    const time = snowflakeTime(message.id);
    const dayDivider = !prev || !sameDay(prev.time, time);
    const header = startsGroup(prev, message, time);
    prev = { message, time };
    return { message, time, header, dayDivider };
  });
}
