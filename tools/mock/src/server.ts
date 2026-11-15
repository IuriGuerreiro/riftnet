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
  HistorySchema,
  MessageAckSchema,
  MessageSchema,
} from "../../../client/src/gen/v1/messages_pb.ts";
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
    case "getHistory":
      return { case: "history", value: create(HistorySchema, { messages: history }) };
    case "sendMessage": {
      const m = req.payload.value;
      const message = create(MessageSchema, {
        id: nextId++,
        conversationId: m.conversationId,
        authorId: 1n,
        seq: ++seq,
        content: m.content,
      });
      history.push(message);
      return { case: "messageAck", value: create(MessageAckSchema, { nonce: m.nonce, message }) };
    }
    default:
      return {
        case: "error",
        value: create(ErrorSchema, {
          code: "not_implemented",
          message: `mock: ${req.payload.case}`,
        }),
      };
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
