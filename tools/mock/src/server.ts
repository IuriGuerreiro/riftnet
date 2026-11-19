import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { WebSocketServer } from "ws";

import {
  AuthOkSchema,
  type Envelope,
  EnvelopeSchema,
  ErrorSchema,
  PongSchema,
} from "../../../client/src/gen/v1/envelope_pb.ts";
import {
  DeleteMessageAckSchema,
  EditMessageAckSchema,
  HistorySchema,
  MessageAckSchema,
  MessageDeletedSchema,
  MessageSchema,
  MessageUpdatedSchema,
  ReactionAckSchema,
  ReactionSchema,
  ReactionUpdatedSchema,
  ReactorsSchema,
  TypingStartedSchema,
} from "../../../client/src/gen/v1/messages_pb.ts";
import {
  PresencesSchema,
  PresenceStatus,
  PresenceUpdatedSchema,
} from "../../../client/src/gen/v1/presence_pb.ts";
import { UserSchema } from "../../../client/src/gen/v1/users_pb.ts";

const PORT = Number(process.env.MOCK_PORT ?? 7101);
const text = new TextEncoder();
let nextId = 1000n;
let seq = 3n;

const history = [
  create(MessageSchema, {
    id: 1n,
    conversationId: 1n,
    authorId: 2n,
    seq: 1n,
    content: text.encode("yo 🐒"),
  }),
  create(MessageSchema, {
    id: 2n,
    conversationId: 1n,
    authorId: 1n,
    seq: 2n,
    content: text.encode("screen share at 60fps?"),
  }),
  create(MessageSchema, {
    id: 3n,
    conversationId: 1n,
    authorId: 2n,
    seq: 3n,
    content: text.encode("source quality bro"),
  }),
];

const ME = 1n;

const reactions = new Map<bigint, Map<string, bigint[]>>([
  [
    1n,
    new Map([
      ["🔥", [1n, 2n]],
      ["😂", [2n]],
    ]),
  ],
]);
const reactionsOf = (messageId: bigint, me = ME) =>
  [...(reactions.get(messageId) ?? new Map<string, bigint[]>())].map(([emoji, users]) =>
    create(ReactionSchema, { emoji, count: users.length, me: users.includes(me) }),
  );
const withReactions = (m: (typeof history)[number]) => ({ ...m, reactions: reactionsOf(m.id) });

function react(conversationId: bigint, messageId: bigint, emoji: string, add: boolean) {
  if (!history.some((m) => m.id === messageId))
    return fail("message_not_found", "message not found");
  if (!emoji || emoji.length > 32) return fail("bad_emoji", "not an emoji");
  const byEmoji = reactions.get(messageId) ?? new Map<string, bigint[]>();
  reactions.set(messageId, byEmoji);
  const users = byEmoji.get(emoji) ?? [];
  const has = users.includes(ME);
  if (add && !byEmoji.has(emoji) && byEmoji.size >= 20)
    return fail("too_many_reactions", "this message has too many different reactions");
  let changeSeq = 0n;
  if (add !== has) {
    const next = add ? [...users, ME] : users.filter((u) => u !== ME);
    if (next.length) byEmoji.set(emoji, next);
    else byEmoji.delete(emoji);
    changeSeq = ++seq;
    pushAll({
      case: "reactionUpdated",
      value: create(ReactionUpdatedSchema, {
        conversationId,
        messageId,
        emoji,
        userId: ME,
        added: add,
        count: next.length,
        seq: changeSeq,
      }),
    });
  }
  return {
    case: "reactionAck" as const,
    value: create(ReactionAckSchema, {
      conversationId,
      messageId,
      seq: changeSeq,
      reactions: reactionsOf(messageId),
    }),
  };
}

function pushAll(payload: Envelope["payload"]) {
  const bytes = toBinary(EnvelopeSchema, create(EnvelopeSchema, { id: 0n, payload }));
  wss.clients.forEach((c) => c.send(bytes));
}
const fail = (code: string, message: string): Envelope["payload"] => ({
  case: "error",
  value: create(ErrorSchema, { code, message }),
});

const presence = new Map<bigint, PresenceStatus>([
  [2n, PresenceStatus.ONLINE],
  [3n, PresenceStatus.IDLE],
]);
const presenceOf = (userId: bigint) =>
  create(PresenceUpdatedSchema, { userId, status: presence.get(userId) ?? PresenceStatus.OFFLINE });

function handle(req: Envelope): Envelope["payload"] {
  switch (req.payload.case) {
    case "authenticate":
      return {
        case: "authOk",
        value: create(AuthOkSchema, {
          user: create(UserSchema, { id: 1n, username: "mock_user" }),
        }),
      };
    case "ping":
      return { case: "pong", value: create(PongSchema) };
    case "getPresence":
      return {
        case: "presences",
        value: create(PresencesSchema, { presences: req.payload.value.userIds.map(presenceOf) }),
      };
    case "setIdle":
      console.log(`client is ${req.payload.value.idle ? "idle" : "active"}`);
      return { case: "pong", value: create(PongSchema) };
    case "getHistory":
      return {
        case: "history",
        value: create(HistorySchema, { messages: history.map(withReactions) }),
      };
    case "addReaction":
    case "removeReaction": {
      const { conversationId, messageId, emoji } = req.payload.value;
      return react(conversationId, messageId, emoji, req.payload.case === "addReaction");
    }
    case "getReactors": {
      const { messageId, emoji } = req.payload.value;
      const userIds = reactions.get(messageId)?.get(emoji) ?? [];
      return { case: "reactors", value: create(ReactorsSchema, { userIds }) };
    }
    case "sendMessage": {
      const m = req.payload.value;
      if (
        m.replyTo &&
        !history.some((h) => h.id === m.replyTo && h.conversationId === m.conversationId)
      )
        return fail("bad_reply", "the replied-to message is not in this conversation");
      const message = create(MessageSchema, {
        id: nextId++,
        conversationId: m.conversationId,
        authorId: 1n,
        seq: ++seq,
        content: m.content,
        replyTo: m.replyTo,
      });
      history.push(message);
      return { case: "messageAck", value: create(MessageAckSchema, { nonce: m.nonce, message }) };
    }
    case "editMessage": {
      const { messageId, content } = req.payload.value;
      const m = history.find((x) => x.id === messageId);
      if (!m) return fail("message_not_found", "message not found");
      if (m.authorId !== ME)
        return fail("not_your_message", "you can only change your own messages");
      if (content.length === 0) return fail("empty_message", "message is empty");
      m.content = content;
      m.editedAt = BigInt(Date.now());
      const changeSeq = ++seq;
      pushAll({
        case: "messageUpdated",
        value: create(MessageUpdatedSchema, { message: m, seq: changeSeq }),
      });
      return {
        case: "editMessageAck",
        value: create(EditMessageAckSchema, { message: m, seq: changeSeq }),
      };
    }
    case "deleteMessage": {
      const { conversationId, messageId } = req.payload.value;
      const i = history.findIndex((x) => x.id === messageId);
      if (i === -1)
        return {
          case: "deleteMessageAck",
          value: create(DeleteMessageAckSchema, { conversationId, messageId }),
        };
      if (history[i]?.authorId !== ME)
        return fail("not_your_message", "you can only change your own messages");
      history.splice(i, 1);
      const changeSeq = ++seq;
      pushAll({
        case: "messageDeleted",
        value: create(MessageDeletedSchema, { conversationId, messageId, seq: changeSeq }),
      });
      return {
        case: "deleteMessageAck",
        value: create(DeleteMessageAckSchema, { conversationId, messageId, seq: changeSeq }),
      };
    }
    default:
      return fail("not_implemented", `mock: ${req.payload.case}`);
  }
}

const wss = new WebSocketServer({ port: PORT, path: "/ws" });
wss.on("connection", (ws) => {
  console.log("client connected");
  ws.on("message", (data) => {
    const req = fromBinary(EnvelopeSchema, new Uint8Array(data as Buffer));
    if (req.payload.case === "startTyping") {
      const conversationId = req.payload.value.conversationId;
      setTimeout(() => {
        const push = create(EnvelopeSchema, {
          id: 0n,
          payload: {
            case: "typingStarted",
            value: create(TypingStartedSchema, { conversationId, userId: 2n }),
          },
        });
        if (ws.readyState === ws.OPEN) ws.send(toBinary(EnvelopeSchema, push));
      }, 1000);
      return;
    }
    const reply = create(EnvelopeSchema, { id: req.id, payload: handle(req) });
    ws.send(toBinary(EnvelopeSchema, reply));
  });
});
console.log(`mock api on ws://127.0.0.1:${PORT}/ws`);

setInterval(() => {
  presence.set(
    2n,
    presence.get(2n) === PresenceStatus.ONLINE ? PresenceStatus.IDLE : PresenceStatus.ONLINE,
  );
  const push = toBinary(
    EnvelopeSchema,
    create(EnvelopeSchema, { id: 0n, payload: { case: "presenceUpdated", value: presenceOf(2n) } }),
  );
  for (const client of wss.clients) client.send(push);
}, 20_000);
