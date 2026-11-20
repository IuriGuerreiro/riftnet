import { sameDay, snowflakeTime } from "../../lib/time";

const GROUP_WINDOW_MS = 7 * 60_000;

interface Groupable {
  id: bigint;
  authorId: bigint;
  replyTo?: unknown;
}

export interface MessageLayout<M extends Groupable> {
  message: M;
  time: Date;
  header: boolean;
  dayDivider: boolean;
}

function startsGroup(
  prev: { message: Groupable; time: Date } | undefined,
  message: Groupable,
  time: Date,
): boolean {
  if (!prev || !sameDay(prev.time, time)) return true;
  if (prev.message.authorId !== message.authorId) return true;
  if (time.getTime() - prev.time.getTime() > GROUP_WINDOW_MS) return true;
  return message.replyTo !== undefined;
}

export function groupMessages<M extends Groupable>(messages: M[]): MessageLayout<M>[] {
  let prev: { message: M; time: Date } | undefined;
  return messages.map((message) => {
    const time = snowflakeTime(message.id);
    const dayDivider = !prev || !sameDay(prev.time, time);
    const header = startsGroup(prev, message, time);
    prev = { message, time };
    return { message, time, header, dayDivider };
  });
}
