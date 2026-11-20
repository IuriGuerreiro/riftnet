import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Ban, Crown, Hash, Users } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { forgetServer, isServerUnavailable } from "../../api/server-access";
import { joinServer, listServerMembers } from "../../api/servers";
import { Avatar } from "../../components/Avatar";
import { Button, ErrorText, IconButton, Skeleton } from "../../components/ui";
import { readWorkspaceSearch } from "../../schemas/workspace";
import { useAuth } from "../../stores/auth";
import { useUi } from "../../stores/ui";
import { ChannelChat } from "./ChannelChat";
import { BanMemberDialog } from "./ServerDialogs";
import { type ServerSummary, useMyServers, useServerChannels } from "./useMyServers";

export function ServerPanel() {
  const { server, invite } = useSearch({ from: "__root__", select: readWorkspaceSearch });
  if (invite) return <JoinInvite key={invite} token={invite} />;
  return server ? <ServerWorkspace key={server} serverId={server} /> : null;
}

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center bg-surface-2 p-6">
      <div className="w-full max-w-sm space-y-4 rounded-panel bg-surface-1 p-6 text-center shadow-lg">
        {children}
      </div>
    </section>
  );
}

function JoinInvite({ token }: { token: string }) {
  const navigate = useNavigate({ from: "/" });
  const queryClient = useQueryClient();
  const userId = useAuth((state) => state.user?.id);
  const join = useMutation({
    mutationFn: () => joinServer(token),
    onSuccess: (server) => {
      queryClient.setQueryData<ServerSummary[]>(["servers", userId], (current) =>
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
    <CenteredCard>
      <h1 className="text-xl font-bold text-fg">You've been invited to a server</h1>
      <p className="text-sm text-fg-muted">Join to start chatting in its channels.</p>
      <ErrorText error={join.error} />
      <div className="flex flex-col gap-2">
        <Button block disabled={join.isPending} onClick={() => join.mutate()}>
          {join.isPending ? "Joining…" : "Accept invite"}
        </Button>
        <Button
          variant="ghost"
          block
          disabled={join.isPending}
          onClick={() => void navigate({ search: {}, replace: true })}
        >
          No thanks
        </Button>
      </div>
    </CenteredCard>
  );
}

function ServerWorkspace({ serverId }: { serverId: string }) {
  const { channel } = useSearch({ from: "__root__", select: readWorkspaceSearch });
  const navigate = useNavigate({ from: "/" });
  const servers = useMyServers();
  const server = servers.data?.find((item) => item.id === serverId);
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const { membersOpen, toggleMembers } = useUi();
  const { access, channels } = useServerChannels(serverId);
  const selected = channels.data?.find((item) => item.id === channel) ?? channels.data?.[0];
  const loseAccess = useCallback(
    () => forgetServer(queryClient, userId, serverId),
    [queryClient, userId, serverId],
  );
  const unavailable = !access.data || isServerUnavailable(channels.error);
  useEffect(() => {
    if (isServerUnavailable(channels.error)) loseAccess();
  }, [channels.error, loseAccess]);

  if (unavailable) {
    return (
      <CenteredCard>
        <p role="status" className="text-fg">
          This server is no longer available.
        </p>
        <Button block onClick={() => void navigate({ search: {}, replace: true })}>
          Back to direct messages
        </Button>
      </CenteredCard>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 bg-surface-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-0 px-4 shadow-sm">
          <Hash size={22} className="shrink-0 text-fg-subtle" />
          <h1 className="truncate font-semibold text-fg">{selected?.name ?? "…"}</h1>
          <div className="ml-auto">
            <IconButton
              label={membersOpen ? "Hide member list" : "Show member list"}
              icon={<Users size={20} />}
              active={membersOpen}
              onClick={toggleMembers}
              className="hidden lg:inline-flex"
            />
          </div>
        </header>
        {selected && !channels.isError ? (
          <ChannelChat
            key={selected.id}
            channelId={selected.id}
            serverId={serverId}
            name={selected.name}
            onUnavailable={loseAccess}
          />
        ) : (
          <div className="m-auto p-4 text-center text-sm text-fg-subtle">
            {channels.isPending && "Loading channels…"}
            {channels.isError && (
              <button type="button" onClick={() => void channels.refetch()}>
                Couldn't load channels. Retry
              </button>
            )}
            {channels.isSuccess && "No text channels yet."}
          </div>
        )}
      </div>
      {membersOpen && channels.isSuccess && (
        <ServerMemberList
          serverId={serverId}
          isOwner={server?.is_owner ?? false}
          onUnavailable={loseAccess}
        />
      )}
    </section>
  );
}

function ServerMemberList({
  serverId,
  isOwner,
  onUnavailable,
}: {
  serverId: string;
  isOwner: boolean;
  onUnavailable: () => void;
}) {
  const userId = useAuth((state) => state.user?.id);
  const [banning, setBanning] = useState<{ id: string; name: string } | null>(null);
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
  const list = members.data?.pages.flatMap((page) => page.members) ?? [];

  return (
    <aside
      aria-label="Members"
      className="hidden w-60 shrink-0 overflow-y-auto bg-surface-1 px-2 py-4 lg:block"
    >
      <h2 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        Members{members.isSuccess && ` — ${list.length}${members.hasNextPage ? "+" : ""}`}
      </h2>
      {members.isPending && (
        <div className="space-y-3 px-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-4/5" />
        </div>
      )}
      {members.isError && (
        <div className="space-y-2 px-2">
          <ErrorText error={members.error} />
          <Button variant="ghost" onClick={() => void members.refetch()}>
            Retry
          </Button>
        </div>
      )}
      <ul>
        {list.map((member) => (
          <li
            key={member.id}
            className="group flex items-center gap-3 rounded-control px-2 py-1.5 hover:bg-surface-3"
          >
            <Avatar userId={member.id} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-muted">
              {member.name}
            </span>
            {member.is_owner && (
              <Crown size={14} className="shrink-0 text-warning" aria-label="Server owner" />
            )}
            {isOwner && !member.is_owner && (
              <IconButton
                label={`Ban ${member.name}`}
                size="sm"
                tone="danger"
                icon={<Ban size={14} />}
                className="hidden group-hover:inline-flex"
                onClick={() => setBanning(member)}
              />
            )}
          </li>
        ))}
      </ul>
      {members.hasNextPage && (
        <Button
          variant="ghost"
          block
          disabled={members.isFetching}
          onClick={() => void members.fetchNextPage()}
        >
          Load more
        </Button>
      )}
      {banning && (
        <BanMemberDialog
          serverId={serverId}
          member={banning}
          onUnavailable={onUnavailable}
          onClose={() => setBanning(null)}
        />
      )}
    </aside>
  );
}
