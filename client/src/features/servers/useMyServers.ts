import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { reconcileServerAccess } from "../../api/server-access";
import { listServerChannels, listServers } from "../../api/servers";
import { useAuth } from "../../stores/auth";

export type ServerSummary = Awaited<ReturnType<typeof listServers>>[number];
export type ServerChannel = Awaited<ReturnType<typeof listServerChannels>>[number];

export function useMyServers() {
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const servers = useQuery({ queryKey: ["servers", userId], queryFn: listServers });
  useEffect(() => {
    if (servers.data && servers.isSuccess) reconcileServerAccess(queryClient, userId, servers.data);
  }, [queryClient, userId, servers.data, servers.isSuccess]);
  return servers;
}

export function useServerAccess(serverId: string) {
  const userId = useAuth((state) => state.user?.id);
  return useQuery({
    queryKey: ["server-access", userId, serverId],
    queryFn: () => true,
    initialData: true,
    staleTime: Infinity,
  });
}

export function useServerChannels(serverId: string) {
  const userId = useAuth((state) => state.user?.id);
  const access = useServerAccess(serverId);
  const channels = useQuery({
    queryKey: ["server-channels", userId, serverId],
    queryFn: () => listServerChannels(serverId),
    enabled: access.data,
    retry: false,
  });
  return { access, channels };
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || "?";
