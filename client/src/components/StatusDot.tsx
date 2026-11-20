import { PresenceStatus, usePresence } from "../stores/presence";

const look: Record<PresenceStatus, { color: string; label: string }> = {
  [PresenceStatus.ONLINE]: { color: "bg-success", label: "Online" },
  [PresenceStatus.DO_NOT_DISTURB]: { color: "bg-danger", label: "Do not disturb" },
  [PresenceStatus.IDLE]: { color: "bg-warning", label: "Idle" },
  [PresenceStatus.OFFLINE]: { color: "bg-surface-4", label: "Offline" },
};

export function StatusDot({
  userId,
  className = "",
}: {
  userId: bigint | string | undefined;
  className?: string;
}) {
  const status =
    usePresence((s) => (userId === undefined ? undefined : s.statuses[userId.toString()])) ??
    PresenceStatus.OFFLINE;
  const { color, label } = look[status];
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${color} ${className}`}
      title={label}
      aria-label={label}
    />
  );
}
