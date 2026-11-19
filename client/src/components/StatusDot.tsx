import { PresenceStatus, usePresence } from "../stores/presence";

const look: Record<PresenceStatus, { color: string; label: string }> = {
  [PresenceStatus.ONLINE]: { color: "bg-success", label: "online" },
  [PresenceStatus.IDLE]: { color: "bg-warning", label: "idle" },
  [PresenceStatus.OFFLINE]: { color: "bg-surface-4", label: "offline" },
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
