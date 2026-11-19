import { create } from "@bufbuild/protobuf";

import {
  type ChannelMessage,
  GetChannelHistorySchema,
  SendChannelMessageSchema,
} from "../gen/v1/messages_pb";
import { type WsClient, WsError } from "./ws";

export async function channelHistory(ws: WsClient, channelId: bigint, beforeId: bigint) {
  const reply = await ws.request({
    case: "getChannelHistory",
    value: create(GetChannelHistorySchema, { channelId, beforeId }),
  });
  if (reply.case !== "channelHistory") throw new WsError("bad_reply", "Expected channel history");
  return reply.value;
}

export async function sendChannelMessage(
  ws: WsClient,
  channelId: bigint,
  text: string,
  nonce: string,
) {
  const reply = await ws.request({
    case: "sendChannelMessage",
    value: create(SendChannelMessageSchema, { channelId, text, nonce }),
  });
  if (reply.case !== "channelMessage") throw new WsError("bad_reply", "Expected a channel message");
  return reply.value;
}

export function onChannelMessage(
  ws: WsClient,
  channelId: bigint,
  receive: (message: ChannelMessage) => void,
) {
  return ws.addPushListener((payload) => {
    if (payload.case === "channelMessage" && payload.value.channelId === channelId) {
      receive(payload.value);
    }
  });
}
