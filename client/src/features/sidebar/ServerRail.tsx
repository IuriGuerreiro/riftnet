import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plus, Users } from "lucide-react";
import { type ReactNode, useState } from "react";

import { AdeptMark } from "../../components/AdeptLogo";
import { Tooltip } from "../../components/ui";
import { cn } from "../../components/ui/cn";
import { readWorkspaceSearch } from "../../schemas/workspace";
import { useChat } from "../../stores/chat";
import { useFriends } from "../../stores/friends";
import { CreateServerDialog } from "../servers/ServerDialogs";
import { initials, useMyServers } from "../servers/useMyServers";

const pill =
  "flex size-12 items-center justify-center overflow-hidden rounded-3xl transition-all duration-150 group-hover:rounded-2xl";

function RailItem({
  label,
  active,
  alert = false,
  onClick,
  className,
  children,
}: {
  label: string;
  active: boolean;
  alert?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="right">
      <span className="group relative flex">
        <span
          className={cn(
            "absolute -left-3 top-1/2 w-1 -translate-y-1/2 rounded-r bg-fg transition-all",
            active ? "h-10" : "h-0 group-hover:h-5",
          )}
        />
        <button
          type="button"
          aria-label={label}
          aria-current={active ? "page" : undefined}
          onClick={onClick}
          className={cn(pill, active && "rounded-2xl", className)}
        >
          {children}
        </button>
        {alert && (
          <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 size-4 rounded-full border-4 border-surface-0 bg-danger" />
        )}
      </span>
    </Tooltip>
  );
}

export function ServerRail({ onCreateGroup }: { onCreateGroup: () => void }) {
  const { server } = useSearch({ from: "__root__", select: readWorkspaceSearch });
  const navigate = useNavigate({ from: "/" });
  const servers = useMyServers();
  const [creating, setCreating] = useState(false);
  const unread = useChat((s) =>
    s.conversations.reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), 0),
  );
  const pending = useFriends((s) => s.list.incoming.length);
  const home = !server;

  return (
    <nav
      aria-label="Servers"
      className="hidden w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-surface-0 py-3 sm:flex"
    >
      <RailItem
        label="Direct messages"
        active={home}
        alert={unread + pending > 0}
        onClick={() => void navigate({ search: {} })}
        className={
          home
            ? "bg-brand text-on-brand"
            : "bg-surface-2 text-fg-muted group-hover:bg-brand group-hover:text-on-brand"
        }
      >
        <AdeptMark tone={home ? "mono" : "brand"} className="size-7 group-hover:hidden" />
        <AdeptMark tone="mono" className="hidden size-7 group-hover:block" />
      </RailItem>
      <span className="h-0.5 w-8 shrink-0 rounded bg-surface-3" />

      {servers.data?.map((item) => {
        const active = item.id === server;
        return (
          <RailItem
            key={item.id}
            label={item.name}
            active={active}
            onClick={() => void navigate({ search: { server: item.id } })}
            className={cn(
              "text-sm font-semibold",
              active
                ? "bg-brand text-on-brand"
                : "bg-surface-2 text-fg group-hover:bg-brand group-hover:text-on-brand",
            )}
          >
            {initials(item.name)}
          </RailItem>
        );
      })}

      <RailItem
        label="Create a server"
        active={false}
        onClick={() => setCreating(true)}
        className="bg-surface-2 text-success group-hover:bg-success group-hover:text-surface-0"
      >
        <Plus size={24} />
      </RailItem>
      <RailItem
        label="Create group DM"
        active={false}
        onClick={() => {
          void navigate({ search: {} });
          onCreateGroup();
        }}
        className="bg-surface-2 text-success group-hover:bg-success group-hover:text-surface-0"
      >
        <Users size={22} />
      </RailItem>
      {servers.isError && (
        <button
          type="button"
          className="px-1 text-center text-[11px] text-danger hover:underline"
          onClick={() => void servers.refetch()}
        >
          Retry
        </button>
      )}
      {creating && <CreateServerDialog onClose={() => setCreating(false)} />}
    </nav>
  );
}
