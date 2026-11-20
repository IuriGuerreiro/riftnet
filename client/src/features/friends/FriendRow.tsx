import type { ReactNode } from "react";

import { Avatar } from "../../components/Avatar";
import { StatusDot } from "../../components/StatusDot";

export function FriendRow({
  label,
  hint,
  activity,
  userId,
  avatarId,
  children,
}: {
  label: string;
  hint?: string;
  activity?: string;
  userId?: string;
  avatarId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Avatar userId={avatarId} size="xs" />
      {userId && <StatusDot userId={userId} />}
      <div className="min-w-0 flex-1">
        <p className="truncate">{label}</p>
        {hint && <p className="text-xs text-zinc-500">{hint}</p>}
        {activity && (
          <p className="truncate text-xs text-green-400" title={activity}>
            {activity}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export function RowButton({
  onClick,
  className,
  children,
}: {
  onClick: () => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <button onClick={onClick} className={`text-xs hover:underline ${className}`}>
      {children}
    </button>
  );
}
