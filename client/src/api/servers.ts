import { z } from "zod";

import { http } from "./http";

const namedResource = z.object({ id: z.string(), name: z.string() });
const serverList = z.array(namedResource.extend({ is_owner: z.boolean() }));
const createdServer = z.object({ server: namedResource, default_channel: namedResource });
const serverInvite = z.object({ token: z.string() });

export async function listServers() {
  return serverList.parse(await http<unknown>("/servers"));
}

export async function createServer(name: string) {
  return createdServer.parse(await http<unknown>("/servers", { method: "POST", body: { name } }));
}

export async function listServerChannels(serverId: string) {
  return z.array(namedResource).parse(await http<unknown>(`/servers/${serverId}/channels`));
}

export async function createServerInvite(serverId: string) {
  return serverInvite.parse(await http<unknown>(`/servers/${serverId}/invite`, { method: "POST" }));
}

export function revokeServerInvite(serverId: string) {
  return http<undefined>(`/servers/${serverId}/invite`, { method: "DELETE" });
}

export async function joinServer(token: string) {
  return namedResource.parse(
    await http<unknown>("/servers/join", { method: "POST", body: { token } }),
  );
}
