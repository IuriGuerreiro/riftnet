import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

import {
  AuthenticateSchema,
  type Envelope,
  EnvelopeSchema,
} from "../../../client/src/gen/v1/envelope_pb.ts";

const HTTP = process.env.API_HTTP ?? "http://127.0.0.1:7100";
const WS = HTTP.replace(/^http/, "ws") + "/ws";
let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failed++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(HTTP + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as unknown };
}

async function newUser(prefix: string) {
  const tag = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const res = await fetch(`${HTTP}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `${tag}@test.local`,
      password: "Password1!",
      device: { name: "smoke", platform: "web" },
    }),
  });
  const session = (await res.json()) as { access_token: string; user: { id: string } };
  const named = await api(session.access_token, "PUT", "/me/username", { username: tag });
  check(`register + username ${tag}`, res.ok && named.status === 200);
  return { token: session.access_token, id: session.user.id, username: tag };
}
import { PresenceStatus } from "../../../client/src/gen/v1/presence_pb.ts";
interface Update {
  userId: bigint;
  status: PresenceStatus;
}

async function open(token: string) {
  const ws = new WebSocket(WS);
  ws.binaryType = "arraybuffer";
  const pushes: Update[] = [];
  const waiting = new Map<bigint, (p: Envelope["payload"]) => void>();
  let nextId = 2n;
  await new Promise<void>((res) => {
    ws.onopen = () =>
      ws.send(
        toBinary(
          EnvelopeSchema,
          create(EnvelopeSchema, {
            id: 1n,
            payload: {
              case: "authenticate",
              value: create(AuthenticateSchema, { accessToken: token }),
            },
          }),
        ),
      );
    ws.onmessage = (ev) => {
      const env = fromBinary(EnvelopeSchema, new Uint8Array(ev.data as ArrayBuffer));
      if (env.payload.case === "authOk") res();
      else if (env.payload.case === "presenceUpdated") pushes.push(env.payload.value);
      else waiting.get(env.id)?.(env.payload);
    };
  });
  const request = (payload: Envelope["payload"]) =>
    new Promise<Envelope["payload"]>((res) => {
      const id = nextId++;
      waiting.set(id, res);
      ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { id, payload })));
    });
  return { pushes, request, stop: () => ws.close() };
}

const about = (pushes: Update[], id: string) =>
  pushes.filter((p) => p.userId.toString() === id).map((p) => PresenceStatus[p.status]);
const setIdle = (idle: boolean) => ({
  case: "setIdle" as const,
  value: { $typeName: "app.v1.SetIdle" as const, idle },
});
async function presence(sock: Awaited<ReturnType<typeof open>>, ids: string[]) {
  const reply = await sock.request({
    case: "getPresence",
    value: { $typeName: "app.v1.GetPresence", userIds: ids.map(BigInt) },
  });
  return reply.case === "presences"
    ? reply.value.presences.map((p) => `${p.userId}:${PresenceStatus[p.status]}`)
    : [`error ${reply.case}`];
}

const ana = await newUser("ana");
const bob = await newUser("bob");
const dan = await newUser("dan");
await api(ana.token, "POST", "/friends/requests", { username: bob.username });
check(
  "ana and bob are friends",
  (await api(bob.token, "POST", `/friends/requests/${ana.id}/accept`)).status === 200,
);

const bobSock = await open(bob.token);
const danSock = await open(dan.token);
await sleep(300);

const ana1 = await open(ana.token);
await sleep(300);
check(
  "ana online → bob told",
  about(bobSock.pushes, ana.id).join() === "ONLINE",
  about(bobSock.pushes, ana.id).join(),
);
check("stranger dan told nothing", about(danSock.pushes, ana.id).length === 0);

const ana2 = await open(ana.token);
await ana1.request(setIdle(true));
await sleep(300);
check(
  "2nd device + one idle: no new push",
  about(bobSock.pushes, ana.id).join() === "ONLINE",
  about(bobSock.pushes, ana.id).join(),
);

await ana2.request(setIdle(true));
await sleep(300);
check(
  "all devices idle → idle",
  about(bobSock.pushes, ana.id).join() === "ONLINE,IDLE",
  about(bobSock.pushes, ana.id).join(),
);
check("ana's other device told too", about(ana1.pushes, ana.id).includes("IDLE"));

const seen = await presence(bobSock, [ana.id, dan.id]);
check("bob sees ana idle, not dan", seen.join() === `${ana.id}:IDLE`, seen.join());
check("dan sees nothing", (await presence(danSock, [ana.id])).length === 0);

ana1.stop();
await sleep(300);
check(
  "closing one device: still idle",
  about(bobSock.pushes, ana.id).join() === "ONLINE,IDLE",
  about(bobSock.pushes, ana.id).join(),
);
ana2.stop();
await sleep(300);
check(
  "last device closed → offline",
  about(bobSock.pushes, ana.id).join() === "ONLINE,IDLE,OFFLINE",
  about(bobSock.pushes, ana.id).join(),
);

bobSock.stop();
danSock.stop();
console.log(failed ? `\n${failed} failed` : "\nall good");
process.exit(failed ? 1 : 0);
