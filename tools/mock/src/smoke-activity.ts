import assert from "node:assert/strict";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

import { CreateGroupSchema, OpenDmSchema } from "../../../client/src/gen/v1/conversations_pb.ts";
import {
  AuthenticateSchema,
  type Envelope,
  EnvelopeSchema,
} from "../../../client/src/gen/v1/envelope_pb.ts";
import {
  GetActivitiesSchema,
  JoinFriendCallSchema,
  SetActivitySchema,
} from "../../../client/src/gen/v1/presence_pb.ts";

const http = process.env.API_HTTP ?? "http://127.0.0.1:7100";
const sockets: WebSocket[] = [];
async function api(token: string, method: string, path: string, body?: unknown) {
  return fetch(http + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function user(prefix: string) {
  const username = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 10000)}`;
  const res = await api("", "POST", "/auth/register", {
    email: `${username}@test.local`,
    password: "Password1!",
    device: { name: "activity smoke", platform: "web" },
  });
  assert.equal(res.status, 200);
  const data: unknown = await res.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("access_token" in data) ||
    typeof data.access_token !== "string" ||
    !("user" in data) ||
    !data.user ||
    typeof data.user !== "object" ||
    !("id" in data.user) ||
    typeof data.user.id !== "string"
  ) {
    throw new Error("Invalid registration response");
  }
  const token = data.access_token;
  assert.equal((await api(token, "PUT", "/me/username", { username })).status, 200);
  return { token, id: data.user.id, username };
}
async function open(token: string) {
  const ws = new WebSocket(http.replace(/^http/, "ws") + "/ws");
  sockets.push(ws);
  ws.binaryType = "arraybuffer";
  const waiting = new Map<bigint, (payload: Envelope["payload"]) => void>();
  let id = 0n;
  ws.onmessage = (event) => {
    if (!(event.data instanceof ArrayBuffer)) throw new Error("Expected binary frame");
    const envelope = fromBinary(EnvelopeSchema, new Uint8Array(event.data));
    waiting.get(envelope.id)?.(envelope.payload);
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("WebSocket failed"));
  });
  const request = (payload: Envelope["payload"]) =>
    new Promise<Envelope["payload"]>((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        waiting.delete(requestId);
        reject(new Error(`Timeout: ${payload.case}`));
      }, 10_000);
      waiting.set(requestId, (reply) => {
        clearTimeout(timer);
        waiting.delete(requestId);
        resolve(reply);
      });
      ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { id: requestId, payload })));
    });
  assert.equal(
    (
      await request({
        case: "authenticate",
        value: create(AuthenticateSchema, { accessToken: token }),
      })
    ).case,
    "authOk",
  );
  return { ws, request };
}
async function read(socket: Awaited<ReturnType<typeof open>>, ids: string[]) {
  const reply = await socket.request({
    case: "getActivities",
    value: create(GetActivitiesSchema, { userIds: ids.map(BigInt) }),
  });
  assert.equal(reply.case, "activities");
  return reply.value.activities;
}
const deadline = setTimeout(() => {
  console.error("Activity smoke exceeded 90 seconds");
  process.exit(1);
}, 90_000);
try {
  const ana = await user("actana");
  const bob = await user("actbob");
  const cat = await user("actcat");
  const [a, b, c] = await Promise.all([open(ana.token), open(bob.token), open(cat.token)]);
  assert.equal(
    (await api(ana.token, "POST", "/friends/requests", { username: bob.username })).status,
    200,
  );
  await a.request({
    case: "setActivity",
    value: create(SetActivitySchema, { label: "Minecraft" }),
  });
  assert.equal((await read(b, [ana.id])).length, 0, "Pending friends cannot read activity");
  assert.equal((await api(bob.token, "POST", `/friends/requests/${ana.id}/accept`)).status, 200);
  const playing = await read(b, [ana.id]);
  assert.equal(playing[0]?.label, "Minecraft");
  assert.equal(playing[0].streaming, false);
  assert.equal(playing[0].joinable, false);
  console.log("✓ Playing is visible to accepted friends only");
  const dm = await c.request({
    case: "openDm",
    value: create(OpenDmSchema, { username: ana.username }),
  });
  assert.equal(dm.case, "conversation");
  assert.equal((await read(c, [ana.id])).length, 0, "DM membership does not disclose activity");
  const denied = await c.request({
    case: "joinFriendCall",
    value: create(JoinFriendCallSchema, { friendId: BigInt(ana.id), sdpOffer: "" }),
  });
  assert.equal(denied.case, "error");
  console.log("✓ DM-only users cannot read activity or resolve a friend's call");
  const invalid = await a.request({
    case: "setActivity",
    value: create(SetActivitySchema, { label: "x".repeat(101) }),
  });
  assert.equal(invalid.case, "error");
  const group = await a.request({
    case: "createGroup",
    value: create(CreateGroupSchema, {
      name: "Activity smoke",
      usernames: [bob.username, cat.username],
    }),
  });
  assert.equal(group.case, "conversation");
  await a.request({ case: "setActivity", value: create(SetActivitySchema, { label: "" }) });
  assert.equal((await read(b, [ana.id])).length, 0);
  console.log("✓ Opt-out clears activity");
  await a.request({
    case: "setActivity",
    value: create(SetActivitySchema, { label: "Minecraft" }),
  });
  assert.equal((await api(ana.token, "DELETE", `/friends/${bob.id}`)).status, 204);
  assert.equal(
    (await read(b, [ana.id])).length,
    0,
    "Shared group does not preserve activity access after unfriend",
  );
  console.log("✓ Unfriend revokes activity despite a shared group");
  assert.equal(
    (await api(ana.token, "POST", "/friends/requests", { username: bob.username })).status,
    200,
  );
  assert.equal((await api(bob.token, "POST", `/friends/requests/${ana.id}/accept`)).status, 200);
  const a2 = await open(ana.token);
  a.ws.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    (await read(b, [ana.id])).length,
    0,
    "Another online device must not retain the closed device's activity",
  );
  await a2.request({
    case: "setActivity",
    value: create(SetActivitySchema, { label: "Other game" }),
  });
  assert.equal((await read(b, [ana.id]))[0]?.label, "Other game");
  console.log("✓ Activity follows its connection across devices and disconnects");
} finally {
  clearTimeout(deadline);
  for (const socket of sockets) socket.close();
}
