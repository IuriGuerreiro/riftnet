import type { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./http";
import { listServers } from "./servers";
import { type WsClient, WsError } from "./ws";

export function isServerUnavailable(error: unknown) {
  return (
    (error instanceof ApiError && error.status === 404) ||
    (error instanceof WsError && error.code === "not_found")
  );
}

export function forgetServer(
  queryClient: QueryClient,
  userId: string | undefined,
  serverId: string,
) {
  void queryClient.cancelQueries({ queryKey: ["servers", userId] });
  queryClient.setQueryData(["server-access", userId, serverId], false);
  queryClient.setQueryData<Awaited<ReturnType<typeof listServers>>>(
    ["servers", userId],
    (current) => current?.filter((server) => server.id !== serverId),
  );
  for (const feature of ["server-channels", "server-members", "server-bans"]) {
    void queryClient.cancelQueries({ queryKey: [feature, userId, serverId] });
    queryClient.removeQueries({ queryKey: [feature, userId, serverId] });
  }
  void queryClient.cancelQueries({ queryKey: ["channel-history", userId, serverId] });
  queryClient.removeQueries({ queryKey: ["channel-history", userId, serverId] });
}

export function onServerRemoved(ws: WsClient, receive: (serverId: string) => void) {
  return ws.addPushListener((payload) => {
    if (payload.case === "serverRemoved") receive(payload.value.serverId.toString());
  });
}

export function reconcileServerAccess(
  queryClient: QueryClient,
  userId: string | undefined,
  servers: Awaited<ReturnType<typeof listServers>>,
) {
  const ids = new Set(servers.map((server) => server.id));
  for (const [key, allowed] of queryClient.getQueriesData<boolean>({
    queryKey: ["server-access", userId],
  })) {
    const serverId = key[2];
    if (typeof serverId !== "string") continue;
    if (ids.has(serverId)) {
      if (allowed === false) queryClient.setQueryData(key, true);
    } else if (allowed !== false) {
      forgetServer(queryClient, userId, serverId);
    }
  }
}

export async function refreshServerAccess(queryClient: QueryClient, userId: string | undefined) {
  const servers = await queryClient.query({
    queryKey: ["servers", userId],
    queryFn: listServers,
    staleTime: 0,
  });
  reconcileServerAccess(queryClient, userId, servers);
  await Promise.all(
    ["server-channels", "server-members", "server-bans"].map((feature) =>
      queryClient.invalidateQueries({ queryKey: [feature, userId] }),
    ),
  );
}
