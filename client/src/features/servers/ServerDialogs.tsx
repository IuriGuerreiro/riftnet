import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { forgetServer, isServerUnavailable } from "../../api/server-access";
import {
  banServerMember,
  createChannel,
  createServer,
  createServerInvite,
  leaveServer,
  listServerBans,
  renameChannel,
  revokeServerInvite,
  unbanServerMember,
} from "../../api/servers";
import { Avatar } from "../../components/Avatar";
import { Button, ErrorText, Input, Modal } from "../../components/ui";
import { platform } from "../../platform";
import { useAuth } from "../../stores/auth";
import type { ServerChannel, ServerSummary } from "./useMyServers";

function NameDialog({
  title,
  label,
  initial = "",
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const formId = useId();
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending || !value.trim()}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim() && !pending) onSubmit(value.trim());
        }}
      >
        <Input
          autoFocus
          label={label}
          value={value}
          disabled={pending}
          onChange={(event) => setValue(event.target.value)}
        />
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}

export function CreateServerDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate({ from: "/" });
  const queryClient = useQueryClient();
  const userId = useAuth((state) => state.user?.id);
  const create = useMutation({
    mutationFn: createServer,
    onSuccess: ({ server, default_channel }) => {
      queryClient.setQueryData<ServerSummary[]>(["servers", userId], (current) => [
        ...(current ?? []),
        { ...server, is_owner: true },
      ]);
      queryClient.setQueryData(["server-channels", userId, server.id], [default_channel]);
      void queryClient.invalidateQueries({ queryKey: ["servers", userId] });
      queryClient.setQueryData(["server-access", userId, server.id], true);
      void navigate({ search: { server: server.id, channel: default_channel.id } });
      onClose();
    },
  });
  return (
    <NameDialog
      title="Create a server"
      label="Server name"
      submitLabel="Create"
      pending={create.isPending}
      error={create.error}
      onSubmit={(name) => create.mutate(name)}
      onClose={onClose}
    />
  );
}

export function ChannelDialog({
  serverId,
  channel,
  onClose,
}: {
  serverId: string;
  channel?: ServerChannel;
  onClose: () => void;
}) {
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/" });
  const save = useMutation({
    mutationFn: (name: string) =>
      channel ? renameChannel(serverId, channel.id, name) : createChannel(serverId, name),
    onSuccess: (saved) => {
      queryClient.setQueryData<ServerChannel[]>(["server-channels", userId, serverId], (current) =>
        channel
          ? current?.map((item) => (item.id === saved.id ? saved : item))
          : [...(current ?? []), saved],
      );
      void queryClient.invalidateQueries({ queryKey: ["server-channels", userId, serverId] });
      void navigate({ search: { server: serverId, channel: saved.id } });
      onClose();
    },
  });
  return (
    <NameDialog
      title={channel ? "Edit channel" : "Create channel"}
      label="Channel name"
      initial={channel?.name}
      submitLabel={channel ? "Save" : "Create channel"}
      pending={save.isPending}
      error={save.error}
      onSubmit={(name) => save.mutate(name)}
      onClose={onClose}
    />
  );
}

export function InviteDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const invite = useMutation({ mutationFn: () => createServerInvite(serverId) });
  const revoke = useMutation({
    mutationFn: () => revokeServerInvite(serverId),
    onSuccess: () => invite.reset(),
  });
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const token = invite.data?.token;
  const url = token ? new URL("/", platform.webUrl) : undefined;
  if (token && url) url.searchParams.set("invite", token);

  return (
    <Modal open title="Invite people" onClose={onClose}>
      {url ? (
        <>
          <div className="flex gap-2">
            <Input
              aria-label="Invite link"
              value={url.href}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              onClick={() => {
                if (!globalThis.isSecureContext) {
                  setCopy("failed");
                  return;
                }
                void navigator.clipboard.writeText(url.href).then(
                  () => setCopy("copied"),
                  () => setCopy("failed"),
                );
              }}
            >
              {copy === "copied" ? <Check size={16} /> : <Copy size={16} />}
              {copy === "copied" ? "Copied" : "Copy"}
            </Button>
          </div>
          {copy === "failed" && (
            <p role="status" className="text-xs text-fg-subtle">
              Couldn't copy. Select the link and copy it yourself.
            </p>
          )}
          <button
            type="button"
            className="text-xs text-danger hover:underline"
            disabled={revoke.isPending}
            onClick={() => {
              setCopy("idle");
              revoke.mutate();
            }}
          >
            Revoke this link
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-fg-muted">
            Make a link that lets friends join this server.
          </p>
          <Button
            disabled={invite.isPending}
            onClick={() => {
              revoke.reset();
              invite.mutate();
            }}
          >
            {invite.isPending ? "Creating…" : "Create invite link"}
          </Button>
        </>
      )}
      <ErrorText error={invite.error ?? revoke.error} />
    </Modal>
  );
}

function ActionDialog({
  title,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" autoFocus disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted">{children}</p>
      <ErrorText error={error} />
    </Modal>
  );
}

export function LeaveServerDialog({
  server,
  onUnavailable,
  onClose,
}: {
  server: ServerSummary;
  onUnavailable: () => void;
  onClose: () => void;
}) {
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/" });
  const leave = useMutation({
    mutationFn: () => leaveServer(server.id),
    onSuccess: () => {
      forgetServer(queryClient, userId, server.id);
      void navigate({ search: {}, replace: true });
    },
    onError: (error) => {
      if (isServerUnavailable(error)) onUnavailable();
    },
  });
  return (
    <ActionDialog
      title={`Leave ${server.name}`}
      confirmLabel="Leave server"
      pending={leave.isPending}
      error={leave.error}
      onConfirm={() => leave.mutate()}
      onClose={onClose}
    >
      You won't be able to rejoin unless someone invites you again.
    </ActionDialog>
  );
}

export function BanMemberDialog({
  serverId,
  member,
  onUnavailable,
  onClose,
}: {
  serverId: string;
  member: { id: string; name: string };
  onUnavailable: () => void;
  onClose: () => void;
}) {
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const ban = useMutation({
    mutationFn: () => banServerMember(serverId, member.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["server-members", userId, serverId] });
      void queryClient.invalidateQueries({ queryKey: ["server-bans", userId, serverId] });
      onClose();
    },
    onError: (error) => {
      if (isServerUnavailable(error)) onUnavailable();
    },
  });
  return (
    <ActionDialog
      title={`Ban ${member.name}`}
      confirmLabel="Ban"
      pending={ban.isPending}
      error={ban.error}
      onConfirm={() => ban.mutate()}
      onClose={onClose}
    >
      They'll be removed and can't rejoin until you unban them.
    </ActionDialog>
  );
}

export function BansDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const bans = useInfiniteQuery({
    queryKey: ["server-bans", userId, serverId],
    queryFn: ({ pageParam }) => listServerBans(serverId, pageParam),
    initialPageParam: "0",
    getNextPageParam: (page) => page.next_after_id ?? undefined,
    retry: false,
  });
  const unban = useMutation({
    mutationFn: (memberId: string) => unbanServerMember(serverId, memberId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["server-bans", userId, serverId] });
    },
  });
  const members = bans.data?.pages.flatMap((page) => page.members) ?? [];

  return (
    <Modal open title="Banned members" onClose={onClose}>
      {bans.isPending && <p className="text-sm text-fg-subtle">Loading…</p>}
      <ErrorText error={bans.error ?? unban.error} />
      {bans.isError && (
        <Button variant="ghost" onClick={() => void bans.refetch()}>
          Retry
        </Button>
      )}
      {bans.isSuccess && members.length === 0 && (
        <p className="text-sm text-fg-subtle">Nobody is banned.</p>
      )}
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex items-center gap-3 rounded-control px-2 py-1.5 hover:bg-surface-3"
          >
            <Avatar userId={member.id} />
            <span className="flex-1 truncate text-sm text-fg">{member.name}</span>
            <Button
              variant="ghost"
              disabled={unban.isPending}
              onClick={() => unban.mutate(member.id)}
            >
              Unban
            </Button>
          </li>
        ))}
      </ul>
      {bans.hasNextPage && (
        <Button
          variant="ghost"
          disabled={bans.isFetching}
          onClick={() => void bans.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </Modal>
  );
}
