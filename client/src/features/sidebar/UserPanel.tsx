import { useNavigate } from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";

import { useLogout } from "../../api/auth";
import { Avatar } from "../../components/Avatar";
import { IconButton } from "../../components/ui";
import { cn } from "../../components/ui/cn";
import { useConnection } from "../../stores/connection";
import { useProfile } from "../../stores/profiles";
import { useNameFor } from "../session/useRealtime";

const statusLook = {
  online: { dot: "bg-success", label: "Online" },
  connecting: { dot: "bg-warning", label: "Connecting…" },
  offline: { dot: "bg-fg-subtle", label: "Offline" },
} as const;

export function UserPanel({ onEditProfile }: { onEditProfile: () => void }) {
  const { status, error, user: me, disconnect, connect } = useConnection();
  const profile = useProfile(me?.id.toString() ?? "");
  const nameFor = useNameFor();
  const logout = useLogout();
  const navigate = useNavigate();
  const look = statusLook[status];

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 bg-surface-0/60 px-2">
      <button
        type="button"
        disabled={!me}
        onClick={onEditProfile}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-control px-1 py-1 text-left hover:bg-surface-3"
      >
        <span className="relative shrink-0">
          <Avatar userId={me?.id} />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-[3px] border-surface-1",
              look.dot,
            )}
          />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold text-fg">
            {me ? nameFor(me.id) : "Loading…"}
          </span>
          <span className="block truncate text-xs text-fg-subtle" title={error ?? undefined}>
            {status === "online" && profile?.username ? `@${profile.username}` : look.label}
          </span>
        </span>
      </button>
      {status === "offline" && (
        <button
          type="button"
          onClick={() => void connect()}
          className="text-xs text-brand hover:underline"
        >
          Retry
        </button>
      )}
      <IconButton
        label="User settings"
        size="sm"
        icon={<Settings size={18} />}
        onClick={onEditProfile}
      />
      <IconButton
        label="Log out"
        size="sm"
        tone="danger"
        icon={<LogOut size={18} />}
        onClick={() => {
          disconnect();
          logout.mutate(undefined, { onSettled: () => void navigate({ to: "/login" }) });
        }}
      />
    </div>
  );
}
