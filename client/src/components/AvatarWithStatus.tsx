import { Avatar } from "./Avatar";
import { StatusDot } from "./StatusDot";

export function AvatarWithStatus({
  userId,
  size = "sm",
}: {
  userId: bigint | string | undefined;
  size?: "xs" | "sm" | "md";
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar userId={userId} size={size} />
      <StatusDot
        userId={userId}
        className="absolute -bottom-0.5 -right-0.5 size-3.5! border-[3px] border-surface-1"
      />
    </span>
  );
}
