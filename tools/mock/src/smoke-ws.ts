import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

import {
  ListConversationsSchema,
  OpenDmSchema,
} from "../../../client/src/gen/v1/conversations_pb.ts";
import {
  AuthenticateSchema,
  type Envelope,
  EnvelopeSchema,
  PingSchema,
} from "../../../client/src/gen/v1/envelope_pb.ts";
import {
  AddReactionSchema,
  DeleteMessageSchema,
  EditMessageSchema,
  GetHistorySchema,
  RemoveReactionSchema,
  SendMessageSchema,
  SyncSchema,
} from "../../../client/src/gen/v1/messages_pb.ts";

const HTTP = process.env.API_HTTP ?? "http://127.0.0.1:7100";
const WS = HTTP.replace(/^http/, "ws") + "/ws";
let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failed++;
};

async function listen(token: string, wsUrl = WS) {
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  const pushes: Envelope[] = [];
  await new Promise<void>((res) => {
    ws.onopen = () =>
      ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { id: 1n, payload: auth(token) })));
    ws.onmessage = (ev) => {
      const env = fromBinary(EnvelopeSchema, new Uint8Array(ev.data as ArrayBuffer));
      if (env.payload.case === "authOk") res();
      else if (env.id === 0n) pushes.push(env);
    };
  });
  return { pushes, stop: () => ws.close() };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function talk(
  payloads: Envelope["payload"][],
  want: number,
): Promise<{ replies: Envelope[]; closeCode?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    ws.binaryType = "arraybuffer";
    const replies: Envelope[] = [];
    ws.onopen = () => {
      for (const [i, payload] of payloads.entries())
        ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { id: BigInt(i + 1), payload })));
    };
    ws.onmessage = (ev) => {
      const env = fromBinary(EnvelopeSchema, new Uint8Array(ev.data as ArrayBuffer));
      if (env.id === 0n && env.payload.case !== "error") return;
      replies.push(env);
      if (replies.length >= want) {
        ws.close();
        resolve({ replies });
      }
    };
    ws.onclose = (ev) => resolve({ replies, closeCode: ev.code });
  });
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

const auth = (accessToken: string) => ({
  case: "authenticate" as const,
  value: create(AuthenticateSchema, { accessToken }),
});
const ping = { case: "ping" as const, value: create(PingSchema) };

let r = await talk([auth(access_token), ping], 2);
check("valid token → authOk", r.replies[0]?.payload.case === "authOk");
check("reply keeps the request id", r.replies[0]?.id === 1n && r.replies[1]?.id === 2n);
check("then ping → pong", r.replies[1]?.payload.case === "pong");

r = await talk([ping], 99);
check(
  "ping before auth → error + close 4001",
  r.replies[0]?.payload.case === "error" && r.closeCode === 4001,
  `close ${r.closeCode}`,
);

r = await talk([auth(access_token.slice(0, -4) + "AAAA")], 99);
const e = r.replies[0]?.payload;
check(
  "forged token → invalid_token + close 4001",
  e?.case === "error" && e.value.code === "invalid_token" && r.closeCode === 4001,
);

r = await talk([auth(access_token), auth(access_token), auth(bob.token)], 3);
check("re-authenticate same session → authOk", r.replies[1]?.payload.case === "authOk");
const e2 = r.replies[2]?.payload;
check(
  "re-authenticate as someone else → wrong_session",
  e2?.case === "error" && e2.value.code === "wrong_session",
);

const openDm = (username: string) => ({
  case: "openDm" as const,
  value: create(OpenDmSchema, { username }),
});
const list = { case: "listConversations" as const, value: create(ListConversationsSchema) };

r = await talk([auth(alice.token), openDm(bob.username), openDm(bob.username.toUpperCase())], 3);
const c1 = r.replies[1]?.payload,
  c1b = r.replies[2]?.payload;
const dmId = c1?.case === "conversation" ? c1.value.conversation?.id : undefined;
check(
  "alice opens DM with bob",
  dmId !== undefined && c1?.case === "conversation" && c1.value.conversation?.members.length === 2,
);
check(
  "opening again (any case) → same DM",
  c1b?.case === "conversation" && c1b.value.conversation?.id === dmId,
);

r = await talk([auth(bob.token), openDm(alice.username), list], 3);
const c2 = r.replies[1]?.payload,
  l = r.replies[2]?.payload;
check(
  "bob opens DM with alice → same DM",
  c2?.case === "conversation" && c2.value.conversation?.id === dmId,
);
check(
  "bob's list has the DM",
  l?.case === "conversations" && l.value.conversations.some((c) => c.id === dmId),
);

const carol = await newUser("carol"),
  dave = await newUser("dave");
const [x, y] = await Promise.all([
  talk([auth(carol.token), openDm(dave.username)], 2),
  talk([auth(dave.token), openDm(carol.username)], 2),
]);
const id = (e?: Envelope) =>
  e?.payload.case === "conversation" ? e.payload.value.conversation?.id : -1n;
check(
  "simultaneous open → one DM",
  id(x.replies[1]) === id(y.replies[1]) && id(x.replies[1]) !== -1n,
);

const errCode = (e?: Envelope) =>
  e?.payload.case === "error" ? e.payload.value.code : e?.payload.case;
r = await talk(
  [auth(alice.token), openDm(`nobody_${Date.now()}`), openDm(alice.username), openDm("x")],
  4,
);
check("unknown user → user_not_found", errCode(r.replies[1]) === "user_not_found");
check("yourself → cannot_dm_self", errCode(r.replies[2]) === "cannot_dm_self");
check("invalid username → user_not_found", errCode(r.replies[3]) === "user_not_found");

const enc = new TextEncoder(),
  dec = new TextDecoder();
const send = (conversationId: bigint, text: string, nonce: string) => ({
  case: "sendMessage" as const,
  value: create(SendMessageSchema, { conversationId, content: enc.encode(text), nonce }),
});
const history = (conversationId: bigint, beforeId = 0n, limit = 0) => ({
  case: "getHistory" as const,
  value: create(GetHistorySchema, { conversationId, beforeId, limit }),
});
const ack = (e?: Envelope) => (e?.payload.case === "messageAck" ? e.payload.value : undefined);
if (dmId === undefined) throw new Error("no DM id");
const dm = dmId;

r = await talk(
  [
    auth(alice.token),
    send(dm, "hello bob", "n1"),
    send(dm, "second", "n2"),
    send(dm, "hello bob", "n1"),
  ],
  4,
);
const a1 = ack(r.replies[1]),
  a2 = ack(r.replies[2]),
  a3 = ack(r.replies[3]);
check(
  "send → ack with same nonce",
  a1?.nonce === "n1" && dec.decode(a1.message?.content) === "hello bob",
);
check("seq goes 1, 2", a1?.message?.seq === 1n && a2?.message?.seq === 2n);
check(
  "retry same nonce → same message, no duplicate",
  a3?.message?.id === a1?.message?.id && a3?.message?.seq === 1n,
);

r = await talk([auth(bob.token), send(dm, "hi alice", "n1")], 2);
check("bob can reuse nonce n1 (nonces are per sender)", ack(r.replies[1])?.message?.seq === 3n);

const burst = await Promise.all([
  talk(
    [auth(alice.token), ...Array.from({ length: 5 }, (_, i) => send(dm, `a${i}`, `burst-a${i}`))],
    6,
  ),
  talk(
    [auth(bob.token), ...Array.from({ length: 5 }, (_, i) => send(dm, `b${i}`, `burst-b${i}`))],
    6,
  ),
]);
const seqs = burst
  .flatMap((b) => b.replies.slice(1).map((e) => ack(e)?.message?.seq ?? 0n))
  .sort((x, y) => Number(x - y));
check(
  "parallel sends → seq 4..13, unique",
  seqs.join(",") === "4,5,6,7,8,9,10,11,12,13",
  seqs.join(","),
);

r = await talk([auth(bob.token), history(dm), history(dm, 0n, 5)], 3);
const h = r.replies[1]?.payload.case === "history" ? r.replies[1].payload.value.messages : [];
const h5 = r.replies[2]?.payload.case === "history" ? r.replies[2].payload.value.messages : [];
check(
  "history has all 13, newest first",
  h.length === 13 && h[0]?.seq === 13n && h[12]?.seq === 1n,
  `${h.length}`,
);
check("limit 5 → 5 newest", h5.length === 5 && h5[0]?.seq === 13n);
r = await talk([auth(bob.token), history(dm, h5[4]?.id, 5)], 2);
const older = r.replies[1]?.payload.case === "history" ? r.replies[1].payload.value.messages : [];
check("before_id → the next 5 older", older.length === 5 && older[0]?.id === h[5]?.id);

r = await talk([auth(carol.token), send(dm, "let me in", "x"), history(dm)], 3);
check("non-member can't send", errCode(r.replies[1]) === "conversation_not_found");
check("non-member can't read", errCode(r.replies[2]) === "conversation_not_found");

r = await talk(
  [
    auth(alice.token),
    send(dm, "", "e"),
    send(dm, "x".repeat(9000), "big"),
    send(dm, "no nonce", ""),
  ],
  4,
);
check("empty → empty_message", errCode(r.replies[1]) === "empty_message");
check("9000 bytes → message_too_long", errCode(r.replies[2]) === "message_too_long");
check("no nonce → bad_nonce", errCode(r.replies[3]) === "bad_nonce");

const created = (e: Envelope) =>
  e.payload.case === "messageCreated" ? e.payload.value.message : undefined;
const WS2 = process.env.API_HTTP_2 ? process.env.API_HTTP_2.replace(/^http/, "ws") + "/ws" : WS;
const bobLive = await listen(bob.token, WS2);
const alicePhone = await listen(alice.token);
const carolLive = await listen(carol.token);
r = await talk([auth(alice.token), send(dm, "live?", "live-1")], 2);
await sleep(300);
const sent = ack(r.replies[1])?.message;
const got = bobLive.pushes.map(created).find((m) => m?.id === sent?.id);
check(
  `bob gets it live${WS2 !== WS ? " (via another api server)" : ""}`,
  !!got && dec.decode(got.content) === "live?",
);
check(
  "alice's other device gets it too",
  alicePhone.pushes.some((e) => created(e)?.id === sent?.id),
);
check(
  "non-member gets no message",
  !carolLive.pushes.some((e) => e.payload.case === "messageCreated"),
  carolLive.pushes.map((e) => e.payload.case).join(","),
);
for (const l of [bobLive, alicePhone, carolLive]) l.stop();

const sync = (conversationId: bigint, afterSeq: bigint) => ({
  case: "sync" as const,
  value: create(SyncSchema, { conversationId, afterSeq }),
});
const synced = (e?: Envelope) => (e?.payload.case === "syncResult" ? e.payload.value : undefined);
r = await talk([auth(bob.token), sync(dm, 10n), sync(dm, 14n), sync(dm, 0n)], 4);
const s10 = synced(r.replies[1]),
  s14 = synced(r.replies[2]),
  s0 = synced(r.replies[3]);
check(
  "sync after 10 → 11..14, oldest first",
  s10?.complete === true && s10.messages.map((m) => m.seq).join(",") === "11,12,13,14",
  s10?.messages.map((m) => m.seq).join(","),
);
check("sync when up to date → empty", s14?.complete === true && s14.messages.length === 0);
check(
  "sync from 0 → all 14",
  s0?.complete === true && s0.messages.length === 14 && s0.messages[0]?.seq === 1n,
);
r = await talk([auth(carol.token), sync(dm, 0n)], 2);
check("non-member can't sync", errCode(r.replies[1]) === "conversation_not_found");

const editMsg = (conversationId: bigint, messageId: bigint, text: string) => ({
  case: "editMessage" as const,
  value: create(EditMessageSchema, { conversationId, messageId, content: enc.encode(text) }),
});
const deleteMsg = (conversationId: bigint, messageId: bigint) => ({
  case: "deleteMessage" as const,
  value: create(DeleteMessageSchema, { conversationId, messageId }),
});
const first = s0?.messages[0],
  bobs = s0?.messages[2];
if (!first || !bobs) throw new Error("sync gave too few messages");
const bobLive2 = await listen(bob.token);
r = await talk(
  [
    auth(alice.token),
    editMsg(dm, first.id, "hello bob!"),
    editMsg(dm, bobs.id, "mine now"),
    deleteMsg(dm, bobs.id),
  ],
  4,
);
const ea = r.replies[1]?.payload;
check(
  "author edits → ack with edited_at + new seq",
  ea?.case === "editMessageAck" &&
    dec.decode(ea.value.message?.content) === "hello bob!" &&
    (ea.value.message?.editedAt ?? 0n) > 0n &&
    ea.value.seq === 15n,
);
check(
  "someone else's message → not_your_message (edit)",
  errCode(r.replies[2]) === "not_your_message",
);
check(
  "someone else's message → not_your_message (delete)",
  errCode(r.replies[3]) === "not_your_message",
);
r = await talk([auth(alice.token), editMsg(dm, first.id, "")], 2);
check("empty edit → empty_message", errCode(r.replies[1]) === "empty_message");
r = await talk([auth(bob.token), deleteMsg(dm, bobs.id), deleteMsg(dm, bobs.id), history(dm)], 4);
const d1 = r.replies[1]?.payload,
  d2 = r.replies[2]?.payload;
check("author deletes → ack with seq 16", d1?.case === "deleteMessageAck" && d1.value.seq === 16n);
check("delete again → ok, seq 0", d2?.case === "deleteMessageAck" && d2.value.seq === 0n);
const hAfter = r.replies[3]?.payload.case === "history" ? r.replies[3].payload.value.messages : [];
check(
  "history: deleted one is gone, edit shows",
  hAfter.length === 13 &&
    !hAfter.some((m) => m.id === bobs.id) &&
    hAfter.some((m) => m.id === first.id && m.editedAt > 0n),
);
await sleep(300);
check(
  "bob got updated + deleted pushes",
  bobLive2.pushes.some((e) => e.payload.case === "messageUpdated") &&
    bobLive2.pushes.some(
      (e) => e.payload.case === "messageDeleted" && e.payload.value.messageId === bobs.id,
    ),
);
bobLive2.stop();
r = await talk([auth(bob.token), sync(dm, 14n)], 2);
const sc = synced(r.replies[1]);
check(
  "sync after 14 → the edit + the delete",
  sc?.messages.length === 0 &&
    sc.edited.some((m) => m.id === first.id) &&
    sc.deletedIds.includes(bobs.id) &&
    sc.lastSeq === 16n,
);

const react = (conversationId: bigint, messageId: bigint, emoji: string, add = true) =>
  add
    ? {
        case: "addReaction" as const,
        value: create(AddReactionSchema, { conversationId, messageId, emoji }),
      }
    : {
        case: "removeReaction" as const,
        value: create(RemoveReactionSchema, { conversationId, messageId, emoji }),
      };
const bobLive3 = await listen(bob.token);
r = await talk([auth(alice.token), react(dm, first.id, "👍"), react(dm, first.id, "👍")], 3);
const ra = r.replies[1]?.payload,
  rb = r.replies[2]?.payload;
check(
  "react → ack with count 1, me, seq 17",
  ra?.case === "reactionAck" &&
    ra.value.seq === 17n &&
    ra.value.reactions.some((x) => x.emoji === "👍" && x.count === 1 && x.me),
);
check("react twice → seq 0", rb?.case === "reactionAck" && rb.value.seq === 0n);
r = await talk([auth(carol.token), react(dm, first.id, "👍")], 2);
check("non-member can't react", errCode(r.replies[1]) === "conversation_not_found");
r = await talk([auth(alice.token), react(dm, first.id, "nope")], 2);
check("bad emoji → bad_emoji", errCode(r.replies[1]) === "bad_emoji");
await new Promise((ok) => setTimeout(ok, 300));
check(
  "bob got reactionUpdated",
  bobLive3.pushes.some((e) => e.payload.case === "reactionUpdated" && e.payload.value.count === 1),
);
bobLive3.stop();
r = await talk([auth(bob.token), sync(dm, 16n)], 2);
const sr = synced(r.replies[1]);
check(
  "sync after 16 → reacted message in edited, not mine",
  sr?.edited.some((m) => m.id === first.id && m.reactions.some((x) => x.count === 1 && !x.me)) ===
    true && sr.lastSeq === 17n,
);

process.exit(failed ? 1 : 0);
