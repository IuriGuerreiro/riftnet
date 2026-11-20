import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import type { listServerChannels } from "../api/servers";
import { createChannel, listServerMembers, renameChannel } from "../api/servers";
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

export function ServerMembers({ serverId }: { serverId: string }) {
  const userId = useAuth((state) => state.user?.id);
  const members = useInfiniteQuery({
    queryKey: ["server-members", userId, serverId],
    queryFn: ({ pageParam }) => listServerMembers(serverId, pageParam),
    initialPageParam: "0",
    getNextPageParam: (page) => page.next_after_id ?? undefined,
    retry: false,
  });
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
