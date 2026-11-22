import { AvatarWithStatus } from "../../components/AvatarWithStatus";
import type { Conversation } from "../../gen/v1/conversations_pb";
import { useActivity } from "../../stores/activity";
import { PresenceStatus, usePresence } from "../../stores/presence";
import { activityText } from "../activity/activity";
import { ProfileTrigger } from "../profile/ProfileTrigger";
import { useNameFor } from "../session/useRealtime";

export function MemberList({ group }: { group: Conversation }) {
  const nameFor = useNameFor();
  const statuses = usePresence((s) => s.statuses);
  const activities = useActivity((s) => s.byId);
  const online = (id: bigint) =>
    (statuses[id.toString()] ?? PresenceStatus.OFFLINE) !== PresenceStatus.OFFLINE;
  const sorted = [...group.members].sort(
    (a, b) =>
      Number(online(b.id)) - Number(online(a.id)) || nameFor(a.id).localeCompare(nameFor(b.id)),
  );

  return (
    <aside
      aria-label="Members"
      className="hidden w-60 shrink-0 overflow-y-auto bg-surface-1 px-2 py-4 lg:block"
    >
      <h2 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        Members — {group.members.length}
      </h2>
      {sorted.map((m) => (
        <ProfileTrigger
          key={m.id.toString()}
          userId={m.id}
          className={`flex w-full items-center gap-3 rounded-control px-2 py-1.5 hover:bg-surface-3 ${
            online(m.id) ? "" : "opacity-50"
          }`}
        >
          <AvatarWithStatus userId={m.id} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-medium text-fg-muted">
              {nameFor(m.id)}
            </span>
            {activityText(activities[m.id.toString()]) && (
              <span className="block truncate text-xs text-fg-subtle">
                {activityText(activities[m.id.toString()])}
              </span>
            )}
          </span>
        </ProfileTrigger>
      ))}
    </aside>
  );
}
