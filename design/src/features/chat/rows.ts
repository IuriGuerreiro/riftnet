import type { Message } from "@/mock/data";

export type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "unread"; key: string }
  | { kind: "message"; key: string; m: Message; head: boolean };

const GAP_MINUTES = 7;

function minutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function buildRows(messages: Message[], unreadFrom: string | null): Row[] {
  const rows: Row[] = [];
  let prev: Message | undefined;
  for (const m of messages) {
    const day = m.day ?? "Today";
    const newDay = (prev?.day ?? "Today") !== day || !prev;
    const unread = m.id === unreadFrom;
    if (newDay) rows.push({ kind: "day", key: `day-${day}-${m.id}`, label: day });
    if (unread) rows.push({ kind: "unread", key: `unread-${m.id}` });
    const head =
      !prev ||
      newDay ||
      unread ||
      prev.author !== m.author ||
      m.replyTo !== undefined ||
      Math.abs(minutes(m.time) - minutes(prev.time)) > GAP_MINUTES;
    rows.push({ kind: "message", key: m.id, m, head });
    prev = m;
  }
  return rows;
}
