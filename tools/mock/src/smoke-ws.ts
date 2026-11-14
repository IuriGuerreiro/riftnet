// End-to-end WebSocket auth checks against the real api.
// Run: node tools/mock/src/smoke-ws.ts   (api on :7100, stack up)
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AuthenticateSchema, EnvelopeSchema, PingSchema, type Envelope } from "../../../client/src/gen/v1/envelope_pb.ts";
import { ListConversationsSchema, OpenDmSchema } from "../../../client/src/gen/v1/conversations_pb.ts";

const HTTP = process.env.API_HTTP ?? "http://127.0.0.1:7100";
const WS = HTTP.replace(/^http/, "ws") + "/ws";
let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failed++;
};

// Opens a socket, sends the frames, collects replies until `want` frames or close.
function talk(payloads: Envelope["payload"][], want: number): Promise<{ replies: Envelope[]; closeCode?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    ws.binaryType = "arraybuffer";
    const replies: Envelope[] = [];
    ws.onopen = () =>
      payloads.forEach((payload, i) => ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { id: BigInt(i + 1), payload }))));
    ws.onmessage = (ev) => {
      replies.push(fromBinary(EnvelopeSchema, new Uint8Array(ev.data as ArrayBuffer)));
      if (replies.length >= want) { ws.close(); resolve({ replies }); }
    };
    ws.onclose = (ev) => resolve({ replies, closeCode: ev.code });
  });
}

// Registers a fresh user with a username. Returns its access token + username.
async function newUser(prefix: string) {
  const tag = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const res = await fetch(`${HTTP}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${tag}@test.local`, password: "Password1!", device: { name: "smoke", platform: "web" } }),
  });
  const { access_token } = (await res.json()) as { access_token: string };
  const named = await fetch(`${HTTP}/me/username`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ username: tag }),
  });
  check(`register + username ${tag}`, res.ok && named.ok);
  return { token: access_token, username: tag };
}

const alice = await newUser("alice");
const bob = await newUser("bob");
const access_token = alice.token;

const auth = (accessToken: string) => ({ case: "authenticate" as const, value: create(AuthenticateSchema, { accessToken }) });
const ping = { case: "ping" as const, value: create(PingSchema) };

let r = await talk([auth(access_token), ping], 2);
check("valid token → authOk", r.replies[0]?.payload.case === "authOk");
check("reply keeps the request id", r.replies[0]?.id === 1n && r.replies[1]?.id === 2n);
check("then ping → pong", r.replies[1]?.payload.case === "pong");

r = await talk([ping], 99);
check("ping before auth → error + close 4001", r.replies[0]?.payload.case === "error" && r.closeCode === 4001, `close ${r.closeCode}`);

r = await talk([auth(access_token.slice(0, -4) + "AAAA")], 99);
const e = r.replies[0]?.payload;
check("forged token → invalid_token + close 4001", e?.case === "error" && e.value.code === "invalid_token" && r.closeCode === 4001);

r = await talk([auth(access_token), auth(access_token)], 2);
const e2 = r.replies[1]?.payload;
check("second authenticate → already_authenticated", e2?.case === "error" && e2.value.code === "already_authenticated");

// --- conversations ---
const openDm = (username: string) => ({ case: "openDm" as const, value: create(OpenDmSchema, { username }) });
const list = { case: "listConversations" as const, value: create(ListConversationsSchema) };

r = await talk([auth(alice.token), openDm(bob.username), openDm(bob.username.toUpperCase())], 3);
const c1 = r.replies[1]?.payload, c1b = r.replies[2]?.payload;
const dmId = c1?.case === "conversation" ? c1.value.conversation?.id : undefined;
check("alice opens DM with bob", dmId !== undefined && c1?.case === "conversation" && c1.value.conversation?.members.length === 2);
check("opening again (any case) → same DM", c1b?.case === "conversation" && c1b.value.conversation?.id === dmId);

r = await talk([auth(bob.token), openDm(alice.username), list], 3);
const c2 = r.replies[1]?.payload, l = r.replies[2]?.payload;
check("bob opens DM with alice → same DM", c2?.case === "conversation" && c2.value.conversation?.id === dmId);
check("bob's list has the DM", l?.case === "conversations" && l.value.conversations.some((c) => c.id === dmId));

// Both open it at the exact same time: still one DM (dm_key is UNIQUE).
const carol = await newUser("carol"), dave = await newUser("dave");
const [x, y] = await Promise.all([
  talk([auth(carol.token), openDm(dave.username)], 2),
  talk([auth(dave.token), openDm(carol.username)], 2),
]);
const id = (e?: Envelope) => (e?.payload.case === "conversation" ? e.payload.value.conversation?.id : -1n);
check("simultaneous open → one DM", id(x.replies[1]) === id(y.replies[1]) && id(x.replies[1]) !== -1n);

const errCode = (e?: Envelope) => (e?.payload.case === "error" ? e.payload.value.code : e?.payload.case);
r = await talk([auth(alice.token), openDm("nobody_" + Date.now()), openDm(alice.username), openDm("x")], 4);
check("unknown user → user_not_found", errCode(r.replies[1]) === "user_not_found");
check("yourself → cannot_dm_self", errCode(r.replies[2]) === "cannot_dm_self");
check("invalid username → user_not_found", errCode(r.replies[3]) === "user_not_found");

process.exit(failed ? 1 : 0);
