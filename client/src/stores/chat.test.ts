import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { WsClient } from "../api/ws";
import type { Envelope } from "../gen/v1/envelope_pb";
import { HistorySchema, MessageAckSchema, MessageSchema } from "../gen/v1/messages_pb";
import { type ChatMessage, replyTarget, useChat } from "./chat";

type Payload = Envelope["payload"];

const msg = (id: bigint, text = "hi"): ChatMessage => ({ id, seq: id, authorId: 1n, text });

function fakeWs(answer: (p: Payload) => Payload) {
  const sent: Payload[] = [];
  const ws = {
    onPush: () => {},
    request: (p: Payload) => {
      sent.push(p);
      return Promise.resolve(answer(p));
    },
  } as unknown as WsClient;
  return { ws, sent };
}

describe("replyTarget", () => {
  it("finds a loaded original", () => {
    expect(replyTarget([msg(1n), msg(2n)], [], 2n)).toEqual({ state: "loaded", message: msg(2n) });
  });
  it("says deleted when we saw it go", () => {
    expect(replyTarget([msg(1n)], [5n], 5n)).toEqual({ state: "deleted" });
  });
  it("says missing when not loaded yet", () => {
    expect(replyTarget([msg(1n)], undefined, 5n)).toEqual({ state: "missing" });
  });
});

describe("chat store replies", () => {
  it("sends reply_to, then clears the reply bar", async () => {
    const { ws, sent } = fakeWs(() => ({
      case: "messageAck",
      value: create(MessageAckSchema, {
        message: create(MessageSchema, { id: 9n, seq: 2n, conversationId: 7n, replyTo: 3n }),
      }),
    }));
    useChat.setState({ selected: 7n, replyingTo: 3n, messages: {}, lastSeq: {} });

    await useChat.getState().send(ws, 1n, "re");

    const req = sent[0];
    expect(req?.case === "sendMessage" && req.value.replyTo).toBe(3n);
    expect(useChat.getState().replyingTo).toBeNull();
    expect(useChat.getState().messages["7"]?.[0]?.replyTo).toBe(3n);
  });

  it("loadUntil pages back until the original shows up", async () => {
    const { ws, sent } = fakeWs(() => ({
      case: "history",
      value: create(HistorySchema, {
        messages: [create(MessageSchema, { id: 4n, seq: 4n, conversationId: 7n })],
      }),
    }));
    useChat.setState({ messages: { "7": [msg(10n)] }, deleted: {} });

    expect(await useChat.getState().loadUntil(ws, 7n, 4n)).toBe(true);
    expect(sent).toHaveLength(1);
  });
});
