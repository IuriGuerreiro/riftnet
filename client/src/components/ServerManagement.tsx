import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { forgetServer, isServerUnavailable } from "../api/server-access";
import type { listServerChannels } from "../api/servers";
import { createChannel, listServerMembers, renameChannel } from "../api/servers";
import { leaveServer, removeServerMember } from "../api/servers";
import { useAuth } from "../stores/auth";
import { Button, ErrorText, Input } from "./ui";

type ChannelAction = { kind: "create" } | { kind: "rename"; id: string; name: string };

export function ChannelControls({
  serverId,
  selected,
}: {
  serverId: string;
  selected: { id: string; name: string } | undefined;
}) {
  const [action, setAction] = useState<ChannelAction | null>(null);
  return action ? (
    <ChannelForm
      key={action.kind === "create" ? "create" : action.id}
      serverId={serverId}
      action={action}
      onClose={() => setAction(null)}
    />
  ) : (
    <div className="flex gap-4 text-sm text-brand">
      <button onClick={() => setAction({ kind: "create" })}>Create channel</button>
      {selected && (
        <button onClick={() => setAction({ kind: "rename", ...selected })}>Rename channel</button>
      )}
    </div>
  );
}

function ChannelForm({
  serverId,
  action,
  onClose,
}: {
  serverId: string;
  action: ChannelAction;
  onClose: () => void;
}) {
  const [name, setName] = useState(action.kind === "rename" ? action.name : "");
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/" });
  const save = useMutation({
    mutationFn: () =>
      action.kind === "create"
        ? createChannel(serverId, name)
        : renameChannel(serverId, action.id, name),
    onSuccess: (channel) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof listServerChannels>>>(
        ["server-channels", userId, serverId],
        (current) =>
          action.kind === "create"
            ? [...(current ?? []), channel]
            : current?.map((item) => (item.id === channel.id ? channel : item)),
      );
      void queryClient.invalidateQueries({ queryKey: ["server-channels", userId, serverId] });
      void navigate({ search: { server: serverId, channel: channel.id } });
      onClose();
    },
  });
  return (
    <form
      className="max-w-sm space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && !save.isPending) save.mutate();
      }}
    >
      <label htmlFor="channel-name" className="block text-sm">
        {action.kind === "create" ? "New channel name" : "Channel name"}
      </label>
      <Input
        id="channel-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        disabled={save.isPending}
      />
      <ErrorText error={save.error} />
      <Button disabled={save.isPending || !name.trim()}>
        {save.isPending ? "Saving…" : "Save channel"}
      </Button>
      <button
        type="button"
        className="text-sm text-zinc-400"
        disabled={save.isPending}
        onClick={onClose}
      >
        Cancel
      </button>
    </form>
  );
}

export function ServerMembers({
  serverId,
  isOwner,
  onUnavailable,
}: {
  serverId: string;
  isOwner: boolean;
  onUnavailable: () => void;
}) {
  const userId = useAuth((state) => state.user?.id);
  const members = useInfiniteQuery({
    queryKey: ["server-members", userId, serverId],
    queryFn: ({ pageParam }) => listServerMembers(serverId, pageParam),
    initialPageParam: "0",
    getNextPageParam: (page) => page.next_after_id ?? undefined,
    retry: false,
  });
  useEffect(() => {
    if (isServerUnavailable(members.error)) onUnavailable();
  }, [members.error, onUnavailable]);
  return (
    <details className="border-b border-zinc-800 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">Members</summary>
      <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
        {members.isPending && <p className="text-sm text-zinc-400">Loading members…</p>}
        {members.isError && (
          <>
            <ErrorText error={members.error} />
            <button className="text-sm text-brand" onClick={() => void members.refetch()}>
              Retry
            </button>
          </>
        )}
        <ul className="space-y-2">
          {members.data?.pages
            .flatMap((page) => page.members)
            .map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{member.name}</span>
                {member.is_owner && <span className="text-xs text-brand">Owner</span>}
                {isOwner && !member.is_owner && (
                  <RemoveMember serverId={serverId} member={member} onUnavailable={onUnavailable} />
                )}
              </li>
            ))}
        </ul>
        {members.hasNextPage && (
          <button
            className="text-sm text-brand"
            disabled={members.isFetching}
            onClick={() => void members.fetchNextPage()}
          >
            Load more members
          </button>
        )}
      </div>
    </details>
  );
}

function RemoveMember({
  serverId,
  member,
  onUnavailable,
}: {
  serverId: string;
  member: { id: string; name: string };
  onUnavailable: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeServerMember(serverId, member.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["server-members", userId, serverId] });
      setConfirming(false);
    },
    onError: (error) => {
      if (isServerUnavailable(error)) onUnavailable();
    },
  });
  return confirming ? (
    <div className="max-w-xs space-y-2 text-sm">
      <p>Remove {member.name}? An active invite will let them rejoin.</p>
      <ErrorText error={remove.error} />
      <button
        className="mr-3 text-red-400"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        Confirm removal
      </button>
      <button
        disabled={remove.isPending}
        onClick={() => {
          remove.reset();
          setConfirming(false);
        }}
      >
        Cancel
      </button>
    </div>
  ) : (
    <button className="text-xs text-red-400" onClick={() => setConfirming(true)}>
      Remove
    </button>
  );
}

export function LeaveServer({
  serverId,
  onUnavailable,
}: {
  serverId: string;
  onUnavailable: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/" });
  const leave = useMutation({
    mutationFn: () => leaveServer(serverId),
    onSuccess: () => {
      forgetServer(queryClient, userId, serverId);
      void navigate({ search: {}, replace: true });
    },
    onError: (error) => {
      if (isServerUnavailable(error)) onUnavailable();
    },
  });
  return confirming ? (
    <div className="space-y-2 text-sm">
      <p>Leave this server?</p>
      <ErrorText error={leave.error} />
      <button
        className="mr-3 text-red-400"
        disabled={leave.isPending}
        onClick={() => leave.mutate()}
      >
        Confirm leave
      </button>
      <button
        disabled={leave.isPending}
        onClick={() => {
          leave.reset();
          setConfirming(false);
        }}
      >
        Cancel
      </button>
    </div>
  ) : (
    <button className="text-sm text-red-400" onClick={() => setConfirming(true)}>
      Leave server
    </button>
  );
}
