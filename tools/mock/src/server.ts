// Fake API for UI work (desktop + mobile). Same contracts as services/api:
//   HTTP  http://127.0.0.1:7100   auth, /me, /users/search, /friends
//   WS    ws://127.0.0.1:7101/ws  Envelope protobuf (chat, groups, sync, call signaling)
// One logged-in user ("you", id 1) plus a few canned people. All in memory.
// Calls ring and can be answered, but there's no SFU: call_join returns an error.
// Uses the TS types generated in client/src/gen (run `pnpm gen` first).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  EnvelopeSchema,
  PongSchema,
  ErrorSchema,
  AuthOkSchema,
  type Envelope,
} from "../../../client/src/gen/v1/envelope_pb.ts";
import { UserSchema, type User } from "../../../client/src/gen/v1/users_pb.ts";
import {
  HistorySchema,
  MessageSchema,
  MessageAckSchema,
  MessageCreatedSchema,
  SyncResultSchema,
  type Message,
} from "../../../client/src/gen/v1/messages_pb.ts";
import {
  ConversationKind,
  ConversationResultSchema,
  ConversationSchema,
  ConversationsSchema,
  ConversationUpdatedSchema,
  type Conversation,
} from "../../../client/src/gen/v1/conversations_pb.ts";
import { FriendState, FriendUpdatedSchema } from "../../../client/src/gen/v1/friends_pb.ts";
import { CallResultSchema, CallSchema, CallState, CallEndedSchema, CallEndReason } from "../../../client/src/gen/v1/calls_pb.ts";

const WS_PORT = Number(process.env.MOCK_PORT ?? 7101);
const HTTP_PORT = Number(process.env.MOCK_HTTP_PORT ?? 7100);
const text = new TextEncoder();
let nextId = 1000n;

// ---- people ----------------------------------------------------------------
const me = create(UserSchema, { id: 1n, username: "you", displayName: "You" });
const people = [
  me,
  create(UserSchema, { id: 2n, username: "ana", displayName: "Ana" }),
  create(UserSchema, { id: 3n, username: "bruno", displayName: "Bruno" }),
  create(UserSchema, { id: 4n, username: "carla", displayName: "Carla" }),
  create(UserSchema, { id: 5n, username: "diogo", displayName: "Diogo" }),
];
let myUsername: string | null = null; // null until PUT /me/username (shows the username screen)
const byName = (u: string) => people.find((p) => p.username === u);
const userJson = (u: User) => ({ id: u.id.toString(), username: u.id === 1n ? myUsername : u.username, display_name: u.displayName || null });

// Friend state from my side.
type JsonState = "friend" | "incoming" | "outgoing";
const friends = new Map<bigint, { state: JsonState; since: string }>([
  [2n, { state: "friend", since: new Date().toISOString() }],
  [3n, { state: "incoming", since: new Date().toISOString() }],
]);

// ---- conversations ---------------------------------------------------------
const conversations: Conversation[] = [
  create(ConversationSchema, { id: 1n, kind: ConversationKind.DM, members: [me, people[1]] }),
];
const messages = new Map<bigint, Message[]>([
  [
    1n,
    [
      create(MessageSchema, { id: 1n, conversationId: 1n, authorId: 2n, seq: 1n, content: text.encode("yo 🐒") }),
      create(MessageSchema, { id: 2n, conversationId: 1n, authorId: 1n, seq: 2n, content: text.encode("screen share at 60fps?") }),
      create(MessageSchema, { id: 3n, conversationId: 1n, authorId: 2n, seq: 3n, content: text.encode("source quality bro") }),
    ],
  ],
]);

function addMessage(conversationId: bigint, authorId: bigint, content: Uint8Array): Message {
  const list = messages.get(conversationId) ?? [];
  const m = create(MessageSchema, { id: nextId++, conversationId, authorId, seq: BigInt(list.length + 1), content });
  messages.set(conversationId, [...list, m]);
  const c = conversations.find((x) => x.id === conversationId);
  if (c) c.lastSeq = m.seq;
  return m;
}

function openDm(other: User): Conversation {
  const found = conversations.find((c) => c.kind === ConversationKind.DM && c.members.some((m) => m.id === other.id));
  if (found) return found;
  const c = create(ConversationSchema, { id: nextId++, kind: ConversationKind.DM, members: [me, other] });
  conversations.unshift(c);
  return c;
}

// ---- WebSocket -------------------------------------------------------------
const sockets = new Set<WebSocket>();
function push(payload: Envelope["payload"]) {
  const bytes = toBinary(EnvelopeSchema, create(EnvelopeSchema, { id: 0n, payload }));
  for (const s of sockets) s.send(bytes);
}
const err = (code: string, message: string): Envelope["payload"] => ({ case: "error", value: create(ErrorSchema, { code, message }) });
const conv = (c: Conversation): Envelope["payload"] => ({ case: "conversation", value: create(ConversationResultSchema, { conversation: c }) });

function handle(req: Envelope): Envelope["payload"] {
  const p = req.payload;
  switch (p.case) {
    case "authenticate": // mock accepts any token
      return { case: "authOk", value: create(AuthOkSchema, { user: create(UserSchema, { ...me, username: myUsername ?? "" }) }) };
    case "ping":
      return { case: "pong", value: create(PongSchema) };
    case "listConversations":
      return { case: "conversations", value: create(ConversationsSchema, { conversations }) };
    case "getHistory": {
      const list = messages.get(p.value.conversationId) ?? [];
      return { case: "history", value: create(HistorySchema, { messages: [...list].reverse().slice(0, p.value.limit || 50) }) };
    }
    case "sync": {
      const list = (messages.get(p.value.conversationId) ?? []).filter((m) => m.seq > p.value.afterSeq);
      return { case: "syncResult", value: create(SyncResultSchema, { messages: list, complete: true }) };
    }
    case "sendMessage": {
      const m = addMessage(p.value.conversationId, 1n, p.value.content);
      // Someone answers a moment later, so live pushes can be tested.
      const c = conversations.find((x) => x.id === p.value.conversationId);
      const other = c?.members.find((u) => u.id !== 1n);
      if (other) {
        setTimeout(() => {
          const reply = addMessage(p.value.conversationId, other.id, text.encode(`${other.username}: got it 👍`));
          push({ case: "messageCreated", value: create(MessageCreatedSchema, { message: reply }) });
        }, 1500);
      }
      return { case: "messageAck", value: create(MessageAckSchema, { nonce: p.value.nonce, message: m }) };
    }
    case "openDm": {
      const other = byName(p.value.username);
      if (!other || other.id === 1n) return err("user_not_found", "no such user");
      return conv(openDm(other));
    }
    case "createGroup": {
      const members = p.value.usernames.map(byName);
      if (members.some((m) => !m)) return err("user_not_found", "no such user");
      const c = create(ConversationSchema, {
        id: nextId++,
        kind: ConversationKind.GROUP,
        name: p.value.name,
        members: [me, ...(members as User[])],
      });
      conversations.unshift(c);
      push({ case: "conversationUpdated", value: create(ConversationUpdatedSchema, { conversation: c }) });
      return conv(c);
    }
    case "addMember":
    case "renameGroup":
    case "leaveGroup": {
      const c = conversations.find((x) => x.id === p.value.conversationId && x.kind === ConversationKind.GROUP);
      if (!c) return err("not_found", "no such group");
      if (p.case === "addMember") {
        const u = byName(p.value.username);
        if (!u) return err("user_not_found", "no such user");
        if (!c.members.some((m) => m.id === u.id)) c.members.push(u);
      } else if (p.case === "renameGroup") c.name = p.value.name;
      else {
        conversations.splice(conversations.indexOf(c), 1);
        return conv(create(ConversationSchema, { ...c, members: c.members.filter((m) => m.id !== 1n) }));
      }
      return conv(c);
    }
    case "callStart": {
      const call = create(CallSchema, { id: nextId++, conversationId: p.value.conversationId, callerId: 1n, state: CallState.RINGING });
      // Nobody picks up in the mock: end it as missed after 20s.
      setTimeout(() => push({ case: "callEnded", value: create(CallEndedSchema, { callId: call.id, conversationId: call.conversationId, reason: CallEndReason.MISSED }) }), 20_000);
      return { case: "callResult", value: create(CallResultSchema, { call }) };
    }
    case "callAccept":
    case "callDecline":
    case "callLeave":
      return { case: "callResult", value: create(CallResultSchema, {}) };
    case "callJoin":
      return err("no_sfu", "the mock has no media server; use the real api for audio");
    default:
      return err("not_implemented", `mock: ${p.case}`);
  }
}

const wss = new WebSocketServer({ port: WS_PORT, path: "/ws" });
wss.on("connection", (ws) => {
  console.log("client connected");
  sockets.add(ws);
  ws.on("close", () => sockets.delete(ws));
  ws.on("message", (data) => {
    const req = fromBinary(EnvelopeSchema, new Uint8Array(data as Buffer));
    const reply = create(EnvelopeSchema, { id: req.id, payload: handle(req) });
    ws.send(toBinary(EnvelopeSchema, reply));
  });
});

// ---- HTTP ------------------------------------------------------------------
function session() {
  return {
    access_token: "mock-access",
    access_expires_at: Math.floor(Date.now() / 1000) + 15 * 60,
    refresh_token: `mock-refresh-${nextId++}`,
    user: userJson(me),
  };
}

function friendJson(id: bigint) {
  const f = friends.get(id)!;
  return { user: userJson(people.find((p) => p.id === id)!), state: f.state, since: f.since };
}

function setFriend(id: bigint, state: JsonState | null) {
  if (state) friends.set(id, { state, since: new Date().toISOString() });
  else friends.delete(id);
  const enumState = { friend: FriendState.FRIEND, incoming: FriendState.INCOMING, outgoing: FriendState.OUTGOING };
  push({
    case: "friendUpdated",
    value: create(FriendUpdatedSchema, { user: people.find((p) => p.id === id), state: state ? enumState[state] : FriendState.NONE }),
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://mock");
  const path = url.pathname;
  const send = (status: number, body?: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const fail = (status: number, code: string, message: string) => send(status, { code, message });
  const m = req.method;

  if (m === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" });
    return res.end();
  }
  if (m === "POST" && (path === "/auth/login" || path === "/auth/register" || path === "/auth/refresh")) return send(200, session());
  if (m === "POST" && path === "/auth/logout") return send(204);
  if (m === "GET" && path === "/me") return send(200, userJson(me));
  if (m === "PUT" && path === "/me/username") {
    const username = String((await readJson(req)).username ?? "");
    if (!/^[a-z0-9_.]{3,32}$/.test(username)) return fail(400, "invalid_username", "3–32 characters: a–z 0–9 _ .");
    if (people.some((p) => p.id !== 1n && p.username === username)) return fail(409, "username_taken", "username taken");
    myUsername = username;
    me.username = username;
    return send(200, userJson(me));
  }
  if (m === "GET" && path === "/users/search") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const limit = Number(url.searchParams.get("limit") ?? 10);
    return send(200, people.filter((p) => p.id !== 1n && q && p.username.startsWith(q)).slice(0, limit).map(userJson));
  }
  if (m === "GET" && path === "/friends") {
    const all = [...friends.keys()].map(friendJson);
    return send(200, {
      friends: all.filter((f) => f.state === "friend"),
      incoming: all.filter((f) => f.state === "incoming"),
      outgoing: all.filter((f) => f.state === "outgoing"),
    });
  }
  if (m === "POST" && path === "/friends/requests") {
    const u = byName(String((await readJson(req)).username ?? ""));
    if (!u || u.id === 1n) return fail(404, "user_not_found", "no such user");
    if (friends.get(u.id)?.state === "friend") return fail(409, "already_friends", "already friends");
    // They sent me one already → we're friends now (same as the api).
    setFriend(u.id, friends.get(u.id)?.state === "incoming" ? "friend" : "outgoing");
    // In the mock, they accept after 3s so pushes can be tested.
    if (friends.get(u.id)?.state === "outgoing") setTimeout(() => friends.has(u.id) && setFriend(u.id, "friend"), 3000);
    return send(200, friendJson(u.id));
  }
  let match = path.match(/^\/friends\/requests\/(\d+)\/accept$/);
  if (m === "POST" && match) {
    const id = BigInt(match[1]);
    if (friends.get(id)?.state !== "incoming") return fail(404, "request_not_found", "no such request");
    setFriend(id, "friend");
    return send(200, friendJson(id));
  }
  match = path.match(/^\/friends(?:\/requests)?\/(\d+)$/);
  if (m === "DELETE" && match) {
    const id = BigInt(match[1]);
    if (!friends.has(id)) return fail(404, "not_found", "nothing to remove");
    setFriend(id, null);
    return send(204);
  }
  return fail(404, "not_found", `mock: ${m} ${path}`);
}

createServer((req, res) => {
  route(req, res).catch((e) => {
    res.writeHead(500);
    res.end(String(e));
  });
}).listen(HTTP_PORT, "0.0.0.0");

console.log(`mock api: http://127.0.0.1:${HTTP_PORT}  ws://127.0.0.1:${WS_PORT}/ws`);
