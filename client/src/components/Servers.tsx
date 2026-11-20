import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { forgetServer, isServerUnavailable } from "../api/server-access";
import {
  createServer,
  createServerInvite,
  joinServer,
  listServerChannels,
  listServers,
  revokeServerInvite,
} from "../api/servers";
import { platform } from "../platform";
import { readWorkspaceSearch } from "../schemas/workspace";
import { useAuth } from "../stores/auth";
import { ChannelChat } from "./ChannelChat";
import { ChannelControls, LeaveServer, ServerMembers } from "./ServerManagement";
import { Button, ErrorText, Input } from "./ui";

function useMyServers() {
  const userId = useAuth((state) => state.user?.id);
  return useQuery({ queryKey: ["servers", userId], queryFn: listServers });
}

export function ServerNavigation() {
  const { server } = useSearch({ from: "__root__", select: readWorkspaceSearch });
  const navigate = useNavigate({ from: "/" });
  const queryClient = useQueryClient();
  const servers = useMyServers();
  const userId = useAuth((state) => state.user?.id);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: createServer,
    onSuccess: ({ server, default_channel }) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof listServers>>>(
        ["servers", userId],
        (current) => [...(current ?? []), { ...server, is_owner: true }],
      );
      queryClient.setQueryData(["server-channels", userId, server.id], [default_channel]);
      void queryClient.invalidateQueries({ queryKey: ["servers", userId] });
      queryClient.setQueryData(["server-access", userId, server.id], true);
      setName("");
      setCreating(false);
      void navigate({ search: { server: server.id, channel: default_channel.id } });
    },
  });

  return (
    <div className="space-y-2 border-b border-zinc-800 p-3">
      <label className="block text-sm font-medium" htmlFor="server-switcher">
        Workspace
      </label>
      <select
        id="server-switcher"
        className="w-full rounded-lg bg-zinc-800 p-2 text-sm"
        value={server ?? ""}
        onChange={(event) => {
          const id = event.currentTarget.value;
          void navigate({ search: id ? { server: id } : {} });
        }}
      >
        <option value="">Direct messages</option>
        {server && !servers.data?.some((item) => item.id === server) && (
          <option value={server}>
            {servers.isSuccess ? "Server unavailable" : "Loading server…"}
          </option>
        )}
        {servers.data?.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      {servers.isError && (
        <button className="text-sm text-red-400" onClick={() => void servers.refetch()}>
          Couldn’t load servers. Retry
        </button>
      )}
      {creating ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!create.isPending && name.trim()) create.mutate(name);
          }}
        >
          <Input
            aria-label="Server name"
            placeholder="Server name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <ErrorText error={create.error} />
          <Button disabled={create.isPending || !name.trim()}>Create</Button>
          <button
            type="button"
            disabled={create.isPending}
            className="text-sm text-zinc-400"
            onClick={() => {
              create.reset();
              setCreating(false);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          className="text-sm font-medium text-brand hover:underline"
          onClick={() => setCreating(true)}
        >
          Create server
        </button>
      )}
    </div>
  );
}

export function ServerPanel() {
  const { server, invite } = useSearch({ from: "__root__", select: readWorkspaceSearch });
  if (invite) return <JoinInvite key={invite} token={invite} />;
  return server ? <ServerWorkspace key={server} serverId={server} /> : null;
}

function JoinInvite({ token }: { token: string }) {
  const navigate = useNavigate({ from: "/" });
  const queryClient = useQueryClient();
  const userId = useAuth((state) => state.user?.id);
  const join = useMutation({
    mutationFn: () => joinServer(token),
    onSuccess: (server) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof listServers>>>(
        ["servers", userId],
        (current) =>
          current?.some((item) => item.id === server.id)
            ? current
            : [...(current ?? []), { ...server, is_owner: false }],
      );
      void queryClient.invalidateQueries({ queryKey: ["servers", userId] });
      queryClient.setQueryData(["server-access", userId, server.id], true);
      void navigate({ search: { server: server.id }, replace: true });
    },
  });
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-4">
        <h1 className="text-xl font-semibold">Join a server</h1>
        <ErrorText error={join.error} />
        <Button disabled={join.isPending} onClick={() => join.mutate()}>
          Accept invite
        </Button>
        <button
          className="text-sm text-zinc-400"
          disabled={join.isPending}
          onClick={() => void navigate({ search: {}, replace: true })}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function ServerWorkspace({ serverId }: { serverId: string }) {
  const { channel } = useSearch({ from: "__root__", select: readWorkspaceSearch });
  const navigate = useNavigate({ from: "/" });
  const servers = useMyServers();
  const server = servers.data?.find((item) => item.id === serverId);
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const access = useQuery({
    queryKey: ["server-access", userId, serverId],
    queryFn: () => true,
    initialData: true,
    staleTime: Infinity,
  });
  const channels = useQuery({
    queryKey: ["server-channels", userId, serverId],
    queryFn: () => listServerChannels(serverId),
    enabled: access.data,
    retry: false,
  });
  const selected = channels.data?.find((item) => item.id === channel) ?? channels.data?.[0];
  const loseAccess = () => forgetServer(queryClient, userId, serverId);
  const unavailable = !access.data || isServerUnavailable(channels.error);
  useEffect(() => {
    if (isServerUnavailable(channels.error)) forgetServer(queryClient, userId, serverId);
  }, [channels.error, queryClient, userId, serverId]);
  if (unavailable) {
    return (
      <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6">
        <p role="status">This server is no longer available.</p>
        <button
          className="text-sm text-brand"
          onClick={() => void navigate({ search: {}, replace: true })}
        >
          Back to direct messages
        </button>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="space-y-3 border-b border-zinc-800 p-4">
        <h1 className="truncate font-semibold">{server?.name ?? "Server"}</h1>
        {selected && (
          <select
            aria-label="Text channel"
            className="max-w-full rounded-lg bg-zinc-800 p-2 text-sm"
            value={selected.id}
            onChange={(event) =>
              void navigate({ search: { server: serverId, channel: event.currentTarget.value } })
            }
          >
            {channels.data?.map((item) => (
              <option key={item.id} value={item.id}>
                # {item.name}
              </option>
            ))}
          </select>
        )}
        {server && !server.is_owner && (
          <LeaveServer serverId={serverId} onUnavailable={loseAccess} />
        )}
        {server?.is_owner && (
          <>
            <ChannelControls serverId={serverId} selected={selected} />
            <InviteControls serverId={serverId} />
          </>
        )}
      </header>
      {channels.isSuccess && (
        <ServerMembers
          serverId={serverId}
          isOwner={server?.is_owner ?? false}
          onUnavailable={loseAccess}
        />
      )}
      {selected && !channels.isError ? (
        <ChannelChat
          key={selected.id}
          channelId={selected.id}
          serverId={serverId}
          name={selected.name}
          onUnavailable={loseAccess}
        />
      ) : (
        <div className="m-auto p-4 text-center text-sm text-zinc-400">
          {channels.isPending && "Loading channels…"}
          {channels.isError && (
            <button onClick={() => void channels.refetch()}>Couldn’t load channels. Retry</button>
          )}
          {channels.isSuccess && "No text channels yet."}
        </div>
      )}
    </section>
  );
}

function InviteControls({ serverId }: { serverId: string }) {
  const invite = useMutation({ mutationFn: () => createServerInvite(serverId) });
  const revoke = useMutation({
    mutationFn: () => revokeServerInvite(serverId),
    onSuccess: () => invite.reset(),
  });
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const token = invite.data?.token;
  const url = token ? new URL("/", platform.webUrl) : undefined;
  if (token && url) url.searchParams.set("invite", token);

  return (
    <div className="space-y-2">
      {url ? (
        <>
          <Input
            aria-label="Invite link"
            value={url.href}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            className="mr-4 text-sm text-brand hover:underline"
            onClick={() => {
              if (!globalThis.isSecureContext) {
                setCopyStatus("failed");
                return;
              }
              void navigator.clipboard.writeText(url.href).then(
                () => setCopyStatus("copied"),
                () => setCopyStatus("failed"),
              );
            }}
          >
            {copyStatus === "copied" ? "Copied" : "Copy invite"}
          </button>
          <button
            className="text-sm text-red-400 hover:underline"
            disabled={revoke.isPending}
            onClick={() => {
              setCopyStatus("idle");
              revoke.mutate();
            }}
          >
            Revoke invite
          </button>
        </>
      ) : (
        <button
          className="text-sm text-brand hover:underline"
          disabled={invite.isPending}
          onClick={() => {
            revoke.reset();
            invite.mutate();
          }}
        >
          Create invite link
        </button>
      )}
      <ErrorText error={invite.error ?? revoke.error} />
      {copyStatus === "failed" && (
        <p role="status" className="text-sm text-zinc-400">
          Select the link above to copy it manually.
        </p>
      )}
    </div>
  );
}
