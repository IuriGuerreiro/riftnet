import { create as createProto } from "@bufbuild/protobuf";
import { create } from "zustand";

import type { WsClient } from "../api/ws";
import {
  type Conversation,
  ListConversationsSchema,
  OpenDmSchema,
} from "../gen/v1/conversations_pb";
import type { Envelope } from "../gen/v1/envelope_pb";
import {
  GetHistorySchema,
  type Message,
  SendMessageSchema,
  SyncSchema,
} from "../gen/v1/messages_pb";

type Key = string;

export interface ChatMessage {
  id: bigint;
  nonce?: string;
  seq: bigint;
  authorId: bigint;
  text: string;
  pending?: boolean;
  failed?: boolean;
}

interface ChatState {
  conversations: Conversation[];
  messages: Partial<Record<Key, ChatMessage[]>>;
  lastSeq: Partial<Record<Key, bigint>>;
  selected: bigint | null;
  error: string | null;

  attach: (ws: WsClient) => Promise<void>;
  openDm: (ws: WsClient, username: string) => Promise<void>;
  select: (ws: WsClient, conversationId: bigint) => Promise<void>;
  send: (ws: WsClient, myId: bigint, text: string) => Promise<void>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const key = (id: bigint): Key => id.toString();
const toChat = (m: Message): ChatMessage => ({
  id: m.id,
  seq: m.seq,
  authorId: m.authorId,
  text: dec.decode(m.content),
});

export const useChat = create<ChatState>()((set, get) => {
  function addMessages(conversationId: bigint, incoming: ChatMessage[]) {
    const k = key(conversationId);
    let list = get().messages[k] ?? [];
    for (const m of incoming) {
      // INVARIANT: a push can arrive before its ack; merge by id and by nonce into one message.
      const same = (x: ChatMessage) =>
        (m.id !== 0n && x.id === m.id) || (!!m.nonce && x.nonce === m.nonce);
      const merged: ChatMessage = Object.assign({}, ...list.filter(same), m, {
        pending: m.pending,
        failed: m.failed,
      }) as ChatMessage;
      list = [...list.filter((x) => !same(x)), merged];
    }
    list.sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || Number(a.seq - b.seq));
    const seen = incoming
      .filter((m) => !m.pending)
      .reduce((max, m) => (m.seq > max ? m.seq : max), get().lastSeq[k] ?? 0n);
    set((s) => ({ messages: { ...s.messages, [k]: list }, lastSeq: { ...s.lastSeq, [k]: seen } }));
  }

  async function sync(ws: WsClient, conversationId: bigint) {
    const after = get().lastSeq[key(conversationId)] ?? 0n;
    const reply = await ws.request({
      case: "sync",
      value: createProto(SyncSchema, { conversationId, afterSeq: after }),
    });
    if (reply.case !== "syncResult") return;
    if (!reply.value.complete) {
      set((s) => ({ messages: { ...s.messages, [key(conversationId)]: [] } }));
    }
    addMessages(conversationId, reply.value.messages.map(toChat));
  }

  async function loadConversations(ws: WsClient) {
    const reply = await ws.request({
      case: "listConversations",
      value: createProto(ListConversationsSchema),
    });
    if (reply.case === "conversations") set({ conversations: reply.value.conversations });
  }

  function onPush(payload: Envelope["payload"], ws: WsClient) {
    if (payload.case !== "messageCreated" || !payload.value.message) return;
    const m = payload.value.message;
    const k = key(m.conversationId);
    const last = get().lastSeq[k];
    if (last !== undefined && m.seq > last + 1n) void sync(ws, m.conversationId);
    addMessages(m.conversationId, [toChat(m)]);
    if (!get().conversations.some((c) => c.id === m.conversationId)) void loadConversations(ws);
  }

  return {
    conversations: [],
    messages: {},
    lastSeq: {},
    selected: null,
    error: null,

    attach: async (ws) => {
      ws.onPush = (p) => onPush(p, ws);
      try {
        await loadConversations(ws);
        for (const k of Object.keys(get().lastSeq)) await sync(ws, BigInt(k));
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },

    openDm: async (ws, username) => {
      try {
        const reply = await ws.request({
          case: "openDm",
          value: createProto(OpenDmSchema, { username }),
        });
        if (reply.case !== "conversation" || !reply.value.conversation) return;
        await loadConversations(ws);
        await get().select(ws, reply.value.conversation.id);
        set({ error: null });
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },

    select: async (ws, conversationId) => {
      set({ selected: conversationId });
      if (get().lastSeq[key(conversationId)] !== undefined) return sync(ws, conversationId);
      const reply = await ws.request({
        case: "getHistory",
        value: createProto(GetHistorySchema, { conversationId, limit: 50 }),
      });
      if (reply.case === "history") addMessages(conversationId, reply.value.messages.map(toChat));
      set((s) => ({
        lastSeq: { ...s.lastSeq, [key(conversationId)]: s.lastSeq[key(conversationId)] ?? 0n },
      }));
    },

    send: async (ws, myId, text) => {
      const conversationId = get().selected;
      if (!conversationId || !text.trim()) return;
      const nonce = crypto.randomUUID();
      addMessages(conversationId, [
        { id: 0n, nonce, seq: 0n, authorId: myId, text, pending: true },
      ]);
      try {
        const reply = await ws.request({
          case: "sendMessage",
          value: createProto(SendMessageSchema, {
            conversationId,
            content: enc.encode(text),
            nonce,
          }),
        });
        if (reply.case === "messageAck" && reply.value.message) {
          addMessages(conversationId, [{ ...toChat(reply.value.message), nonce, pending: false }]);
        }
      } catch (e) {
        addMessages(conversationId, [
          { id: 0n, nonce, seq: 0n, authorId: myId, text, pending: true, failed: true },
        ]);
        set({ error: (e as Error).message });
      }
    },
  };
});
