import type { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./http";
import type { listServers } from "./servers";
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
  for (const feature of ["server-channels", "server-members"]) {
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
