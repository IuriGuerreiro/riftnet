import { PresenceStatus } from "../gen/v1/presence_pb";
import { usePresence } from "../stores/presence";

const look: Record<PresenceStatus, { color: string; label: string }> = {
  [PresenceStatus.ONLINE]: { color: "bg-green-500", label: "online" },
  [PresenceStatus.IDLE]: { color: "bg-yellow-500", label: "idle" },
  [PresenceStatus.OFFLINE]: { color: "bg-zinc-600", label: "offline" },
};

/** Small online / idle / offline dot for one user. */
export function StatusDot({ userId }: { userId: bigint | string | undefined }) {
  const status = usePresence((s) => (userId === undefined ? undefined : s.statuses[userId.toString()])) ?? PresenceStatus.OFFLINE;
  const { color, label } = look[status];
  return <span className={`inline-block size-2 shrink-0 rounded-full ${color}`} title={label} aria-label={label} />;
}
