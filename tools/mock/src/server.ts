// Fake API on ws://127.0.0.1:7101/ws. Same Envelope contract as services/api,
// with canned data so the UI can be built before the real backend exists.
// Uses the TS types generated in client/src/gen (run `pnpm gen` first).
import { WebSocketServer } from "ws";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { EnvelopeSchema, PongSchema, ErrorSchema, AuthOkSchema, type Envelope } from "../../../client/src/gen/v1/envelope_pb.ts";
import { UserSchema } from "../../../client/src/gen/v1/users_pb.ts";
import {
  DeleteMessageAckSchema,
  EditMessageAckSchema,
  HistorySchema,
  MessageAckSchema,
  MessageDeletedSchema,
  MessageSchema,
  MessageUpdatedSchema,
} from "../../../client/src/gen/v1/messages_pb.ts";

const PORT = Number(process.env.MOCK_PORT ?? 7101);
const text = new TextEncoder();
let nextId = 1000n;
let seq = 3n;

const history = [
  create(MessageSchema, { id: 1n, conversationId: 1n, authorId: 2n, seq: 1n, content: text.encode("yo 🐒") }),
  create(MessageSchema, { id: 2n, conversationId: 1n, authorId: 1n, seq: 2n, content: text.encode("screen share at 60fps?") }),
  create(MessageSchema, { id: 3n, conversationId: 1n, authorId: 2n, seq: 3n, content: text.encode("source quality bro") }),
];

const ME = 1n; // the mock signs everyone in as user 1

// Pushes go to every connected socket (they're all "user 1").
function pushAll(payload: Envelope["payload"]) {
  const bytes = toBinary(EnvelopeSchema, create(EnvelopeSchema, { id: 0n, payload }));
  wss.clients.forEach((c) => c.send(bytes));
}
const fail = (code: string, message: string): Envelope["payload"] => ({ case: "error", value: create(ErrorSchema, { code, message }) });

function handle(req: Envelope): Envelope["payload"] {
  switch (req.payload.case) {
    case "authenticate": // mock accepts any token
      return { case: "authOk", value: create(AuthOkSchema, { user: create(UserSchema, { id: 1n, username: "mock_user" }) }) };
    case "ping":
      return { case: "pong", value: create(PongSchema) };
    case "getHistory":
      return { case: "history", value: create(HistorySchema, { messages: history }) };
    case "sendMessage": {
      const m = req.payload.value;
      const message = create(MessageSchema, { id: nextId++, conversationId: m.conversationId, authorId: 1n, seq: ++seq, content: m.content });
      history.push(message);
      return { case: "messageAck", value: create(MessageAckSchema, { nonce: m.nonce, message }) };
    }
    case "editMessage": {
      const { messageId, content } = req.payload.value;
      const m = history.find((x) => x.id === messageId);
      if (!m) return fail("message_not_found", "message not found");
      if (m.authorId !== ME) return fail("not_your_message", "you can only change your own messages");
      if (content.length === 0) return fail("empty_message", "message is empty");
      m.content = content;
      m.editedAt = BigInt(Date.now());
      const changeSeq = ++seq;
      pushAll({ case: "messageUpdated", value: create(MessageUpdatedSchema, { message: m, seq: changeSeq }) });
      return { case: "editMessageAck", value: create(EditMessageAckSchema, { message: m, seq: changeSeq }) };
    }
    case "deleteMessage": {
      const { conversationId, messageId } = req.payload.value;
      const i = history.findIndex((x) => x.id === messageId);
      if (i === -1) return { case: "deleteMessageAck", value: create(DeleteMessageAckSchema, { conversationId, messageId }) };
      if (history[i].authorId !== ME) return fail("not_your_message", "you can only change your own messages");
      history.splice(i, 1);
      const changeSeq = ++seq;
      pushAll({ case: "messageDeleted", value: create(MessageDeletedSchema, { conversationId, messageId, seq: changeSeq }) });
      return { case: "deleteMessageAck", value: create(DeleteMessageAckSchema, { conversationId, messageId, seq: changeSeq }) };
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
    const reply = create(EnvelopeSchema, { id: req.id, payload: handle(req) });
    ws.send(toBinary(EnvelopeSchema, reply));
  });
});
console.log(`mock api on ws://127.0.0.1:${PORT}/ws`);
