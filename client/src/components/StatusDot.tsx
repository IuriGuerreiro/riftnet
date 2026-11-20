import { PresenceStatus, usePresence } from "../stores/presence";

const look: Record<PresenceStatus, { color: string; label: string }> = {
  [PresenceStatus.ONLINE]: { color: "bg-green-500", label: "online" },
  [PresenceStatus.DO_NOT_DISTURB]: { color: "bg-red-500", label: "do not disturb" },
  [PresenceStatus.IDLE]: { color: "bg-yellow-500", label: "idle" },
  [PresenceStatus.OFFLINE]: { color: "bg-zinc-600", label: "offline" },
};

export function StatusDot({ userId }: { userId: bigint | string | undefined }) {
  const status =
    usePresence((s) => (userId === undefined ? undefined : s.statuses[userId.toString()])) ??
    PresenceStatus.OFFLINE;
  const { color, label } = look[status];
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${color}`}
      title={label}
      aria-label={label}
    />
  );
}
