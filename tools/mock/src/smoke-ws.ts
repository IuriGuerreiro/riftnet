// End-to-end WebSocket auth checks against the real api.
// Run: node tools/mock/src/smoke-ws.ts   (api on :7100, stack up)
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AuthenticateSchema, EnvelopeSchema, PingSchema, type Envelope } from "../../../client/src/gen/v1/envelope_pb.ts";
import { ListConversationsSchema, OpenDmSchema } from "../../../client/src/gen/v1/conversations_pb.ts";
import { GetHistorySchema, SendMessageSchema } from "../../../client/src/gen/v1/messages_pb.ts";

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

// --- messages ---
const enc = new TextEncoder(), dec = new TextDecoder();
const send = (conversationId: bigint, text: string, nonce: string) => ({
  case: "sendMessage" as const,
  value: create(SendMessageSchema, { conversationId, content: enc.encode(text), nonce }),
});
const history = (conversationId: bigint, beforeId = 0n, limit = 0) => ({
  case: "getHistory" as const,
  value: create(GetHistorySchema, { conversationId, beforeId, limit }),
});
const ack = (e?: Envelope) => (e?.payload.case === "messageAck" ? e.payload.value : undefined);
const dm = dmId!;

r = await talk([auth(alice.token), send(dm, "hello bob", "n1"), send(dm, "second", "n2"), send(dm, "hello bob", "n1")], 4);
const a1 = ack(r.replies[1]), a2 = ack(r.replies[2]), a3 = ack(r.replies[3]);
check("send → ack with same nonce", a1?.nonce === "n1" && dec.decode(a1.message?.content) === "hello bob");
check("seq goes 1, 2", a1?.message?.seq === 1n && a2?.message?.seq === 2n);
check("retry same nonce → same message, no duplicate", a3?.message?.id === a1?.message?.id && a3?.message?.seq === 1n);

r = await talk([auth(bob.token), send(dm, "hi alice", "n1")], 2);
check("bob can reuse nonce n1 (nonces are per sender)", ack(r.replies[1])?.message?.seq === 3n);

// 10 sends at the same time from two sockets: every seq is unique, no gaps.
const burst = await Promise.all([
  talk([auth(alice.token), ...Array.from({ length: 5 }, (_, i) => send(dm, `a${i}`, `burst-a${i}`))], 6),
  talk([auth(bob.token), ...Array.from({ length: 5 }, (_, i) => send(dm, `b${i}`, `burst-b${i}`))], 6),
]);
const seqs = burst.flatMap((b) => b.replies.slice(1).map((e) => ack(e)?.message?.seq ?? 0n)).sort((x, y) => Number(x - y));
check("parallel sends → seq 4..13, unique", seqs.join(",") === "4,5,6,7,8,9,10,11,12,13", seqs.join(","));

r = await talk([auth(bob.token), history(dm), history(dm, 0n, 5)], 3);
const h = r.replies[1]?.payload.case === "history" ? r.replies[1].payload.value.messages : [];
const h5 = r.replies[2]?.payload.case === "history" ? r.replies[2].payload.value.messages : [];
check("history has all 13, newest first", h.length === 13 && h[0].seq === 13n && h[12].seq === 1n, `${h.length}`);
check("limit 5 → 5 newest", h5.length === 5 && h5[0].seq === 13n);
r = await talk([auth(bob.token), history(dm, h5[4].id, 5)], 2);
const older = r.replies[1]?.payload.case === "history" ? r.replies[1].payload.value.messages : [];
check("before_id → the next 5 older", older.length === 5 && older[0].seq === h5[4].seq - 1n);

r = await talk([auth(carol.token), send(dm, "let me in", "x"), history(dm)], 3);
check("non-member can't send", errCode(r.replies[1]) === "conversation_not_found");
check("non-member can't read", errCode(r.replies[2]) === "conversation_not_found");

r = await talk([auth(alice.token), send(dm, "", "e"), send(dm, "x".repeat(9000), "big"), send(dm, "no nonce", "")], 4);
check("empty → empty_message", errCode(r.replies[1]) === "empty_message");
check("9000 bytes → message_too_long", errCode(r.replies[2]) === "message_too_long");
check("no nonce → bad_nonce", errCode(r.replies[3]) === "bad_nonce");

process.exit(failed ? 1 : 0);
