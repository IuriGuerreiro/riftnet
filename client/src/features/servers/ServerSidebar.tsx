import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Ban, ChevronDown, Hash, LogOut, Plus, Settings, UserPen, UserPlus } from "lucide-react";
import { useState } from "react";

import { forgetServer } from "../../api/server-access";
import { IconButton, Menu, type MenuItem, Skeleton } from "../../components/ui";
import { cn } from "../../components/ui/cn";
import { useAuth } from "../../stores/auth";
import {
  BansDialog,
  ChannelDialog,
  InviteDialog,
  LeaveServerDialog,
  NicknameDialog,
} from "./ServerDialogs";
import { type ServerChannel, useMyServers, useServerChannels } from "./useMyServers";

type Dialog =
  | { kind: "invite" }
  | { kind: "bans" }
  | { kind: "leave" }
  | { kind: "nickname" }
  | { kind: "channel"; channel?: ServerChannel };

export function ServerSidebar({
  serverId,
  channelId,
}: {
  serverId: string;
  channelId: string | undefined;
}) {
  const servers = useMyServers();
  const server = servers.data?.find((item) => item.id === serverId);
  const { channels } = useServerChannels(serverId);
  const navigate = useNavigate({ from: "/" });
  const queryClient = useQueryClient();
  const userId = useAuth((state) => state.user?.id);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const selected = channels.data?.find((c) => c.id === channelId) ?? channels.data?.[0];
  const owner = server?.is_owner ?? false;
  const close = () => setDialog(null);

  const items: MenuItem[] = [
    {
      label: "Change nickname",
      icon: <UserPen size={16} />,
      onSelect: () => setDialog({ kind: "nickname" }),
    },
    ...(owner
      ? [
          {
            label: "Invite people",
            icon: <UserPlus size={16} />,
            onSelect: () => setDialog({ kind: "invite" }),
          },
          {
            label: "Create channel",
            icon: <Plus size={16} />,
            onSelect: () => setDialog({ kind: "channel" }),
          },
          {
            label: "Banned members",
            icon: <Ban size={16} />,
            onSelect: () => setDialog({ kind: "bans" }),
          },
        ]
      : [
          {
            label: "Leave server",
            icon: <LogOut size={16} />,
            danger: true,
            onSelect: () => setDialog({ kind: "leave" }),
          },
        ]),
  ];

  return (
    <>
      <Menu
        align="start"
        className="flex w-full"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            aria-expanded={open}
            onClick={toggle}
            className="flex h-12 w-full shrink-0 items-center gap-2 border-b border-surface-0 px-4 text-left font-semibold text-fg shadow-sm transition-colors hover:bg-surface-3"
          >
            <span className="flex-1 truncate">{server?.name ?? "Server"}</span>
            <ChevronDown size={18} className={cn("transition-transform", open && "rotate-180")} />
          </button>
        )}
        items={items}
      />

      <nav aria-label="Channels" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div className="flex items-center justify-between px-2 pb-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            Text channels
          </h2>
          {owner && (
            <IconButton
              label="Create channel"
              size="sm"
              icon={<Plus size={16} />}
              onClick={() => setDialog({ kind: "channel" })}
            />
          )}
        </div>
        {channels.isPending && (
          <div className="space-y-2 px-2 pt-1">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        )}
        {channels.isError && (
          <button
            type="button"
            className="px-2 text-sm text-danger hover:underline"
            onClick={() => void channels.refetch()}
          >
            Couldn't load channels. Retry
          </button>
        )}
        <ul className="space-y-0.5">
          {channels.data?.map((channel) => {
            const active = channel.id === selected?.id;
            return (
              <li key={channel.id} className="group relative">
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() =>
                    void navigate({ search: { server: serverId, channel: channel.id } })
                  }
                  className={cn(
                    "flex h-8 w-full items-center gap-1.5 rounded-control px-2 text-left text-[15px] font-medium transition-colors",
                    active
                      ? "bg-surface-4 text-fg"
                      : "text-fg-subtle hover:bg-surface-3 hover:text-fg-muted",
                  )}
                >
                  <Hash size={18} className="shrink-0 opacity-70" />
                  <span className="truncate">{channel.name}</span>
                </button>
                {owner && (
                  <button
                    type="button"
                    aria-label={`Edit #${channel.name}`}
                    onClick={() => setDialog({ kind: "channel", channel })}
                    className={cn(
                      "absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg",
                      active ? "block" : "hidden group-hover:block",
                    )}
                  >
                    <Settings size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {dialog?.kind === "invite" && <InviteDialog serverId={serverId} onClose={close} />}
      {dialog?.kind === "bans" && <BansDialog serverId={serverId} onClose={close} />}
      {dialog?.kind === "channel" && (
        <ChannelDialog serverId={serverId} channel={dialog.channel} onClose={close} />
      )}
      {dialog?.kind === "leave" && server && (
        <LeaveServerDialog
          server={server}
          onUnavailable={() => forgetServer(queryClient, userId, serverId)}
          onClose={close}
        />
      )}
      {dialog?.kind === "nickname" && (
        <NicknameDialog
          serverId={serverId}
          onUnavailable={() => forgetServer(queryClient, userId, serverId)}
          onClose={close}
        />
      )}
    </>
  );
}
