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

export async function createChannel(serverId: string, name: string) {
  return namedResource.parse(
    await http<unknown>(`/servers/${serverId}/channels`, {
      method: "POST",
      body: { name },
    }),
  );
}

export async function renameChannel(serverId: string, channelId: string, name: string) {
  return namedResource.parse(
    await http<unknown>(`/servers/${serverId}/channels/${channelId}`, {
      method: "PATCH",
      body: { name },
    }),
  );
}

const serverMember = namedResource.extend({
  is_owner: z.boolean(),
  nickname: z.string().nullable().optional(),
});
export type ServerMember = z.infer<typeof serverMember>;

const membersPage = z.object({
  members: z.array(serverMember),
  next_after_id: z.string().nullable(),
});

export async function listServerMembers(serverId: string, afterId: string) {
  return membersPage.parse(
    await http<unknown>(`/servers/${serverId}/members?after_id=${encodeURIComponent(afterId)}`),
  );
}

export function banServerMember(serverId: string, userId: string) {
  return http<undefined>(`/servers/${serverId}/bans/${userId}`, { method: "POST" });
}

export function leaveServer(serverId: string) {
  return http<undefined>(`/servers/${serverId}/leave`, { method: "POST" });
}

export function unbanServerMember(serverId: string, userId: string) {
  return http<undefined>(`/servers/${serverId}/bans/${userId}`, { method: "DELETE" });
}

export async function listServerBans(serverId: string, afterId: string) {
  return membersPage.parse(
    await http<unknown>(`/servers/${serverId}/bans?after_id=${encodeURIComponent(afterId)}`),
  );
}

const nicknameResult = z.object({ nickname: z.string().nullable(), name: z.string() });

export async function setServerNickname(serverId: string, nickname: string) {
  return nicknameResult.parse(
    await http<unknown>(`/servers/${serverId}/members/me/nickname`, {
      method: "PUT",
      body: { nickname },
    }),
  );
}
