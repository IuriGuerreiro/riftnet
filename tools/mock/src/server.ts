// Fake API on ws://127.0.0.1:7101/ws. Same Envelope contract as services/api,
// with canned data so the UI can be built before the real backend exists.
// Uses the TS types generated in client/src/gen (run `pnpm gen` first).
import { WebSocketServer } from "ws";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { EnvelopeSchema, PongSchema, ErrorSchema, AuthOkSchema, type Envelope } from "../../../client/src/gen/v1/envelope_pb.ts";
import { UserSchema } from "../../../client/src/gen/v1/users_pb.ts";
import { HistorySchema, MessageSchema, MessageAckSchema, TypingStartedSchema } from "../../../client/src/gen/v1/messages_pb.ts";

const PORT = Number(process.env.MOCK_PORT ?? 7101);
const text = new TextEncoder();
let nextId = 1000n;
let seq = 3n;

const history = [
  create(MessageSchema, { id: 1n, conversationId: 1n, authorId: 2n, seq: 1n, content: text.encode("yo 🐒") }),
  create(MessageSchema, { id: 2n, conversationId: 1n, authorId: 1n, seq: 2n, content: text.encode("screen share at 60fps?") }),
  create(MessageSchema, { id: 3n, conversationId: 1n, authorId: 2n, seq: 3n, content: text.encode("source quality bro") }),
];

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
    default:
      return { case: "error", value: create(ErrorSchema, { code: "not_implemented", message: `mock: ${req.payload.case}` }) };
  }
}

const wss = new WebSocketServer({ port: PORT, path: "/ws" });
wss.on("connection", (ws) => {
  console.log("client connected");
  ws.on("message", (data) => {
    const req = fromBinary(EnvelopeSchema, new Uint8Array(data as Buffer));
    // Fire-and-forget, no reply. Everyone here is user 1, so fake the other
    // side: user 2 "types back" a second later (shows for ~8s on the client).
    if (req.payload.case === "startTyping") {
      const conversationId = req.payload.value.conversationId;
      setTimeout(() => {
        const push = create(EnvelopeSchema, {
          id: 0n,
          payload: { case: "typingStarted", value: create(TypingStartedSchema, { conversationId, userId: 2n }) },
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
