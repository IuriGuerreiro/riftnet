const SNOWFLAKE_EPOCH_MS = 1_767_225_600_000;

export function snowflakeTime(id: bigint): Date {
  return id === 0n ? new Date() : new Date(Number(id >> 22n) + SNOWFLAKE_EPOCH_MS);
}

export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export const formatClock = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export function formatStamp(d: Date, now = new Date()): string {
  if (sameDay(d, now)) return `Today at ${formatClock(d)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `Yesterday at ${formatClock(d)}`;
  return `${d.toLocaleDateString()} ${formatClock(d)}`;
}

export const formatDay = (d: Date) =>
  d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
