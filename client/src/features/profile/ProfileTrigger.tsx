import type { ReactNode } from "react";

import { cn } from "../../components/ui";
import { useProfileCard } from "../../stores/profileCard";

export const TRIGGER_ATTR = "data-profile-trigger";

export function ProfileTrigger({
  userId,
  children,
  className,
  label,
}: {
  userId: string | bigint | undefined;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const toggle = useProfileCard((s) => s.toggle);
  if (userId === undefined) return <>{children}</>;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={label}
      {...{ [TRIGGER_ATTR]: "" }}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        toggle(userId.toString(), { top: r.top, left: r.left, right: r.right, bottom: r.bottom });
      }}
      className={cn("cursor-pointer text-left", className)}
    >
      {children}
    </button>
  );
}
