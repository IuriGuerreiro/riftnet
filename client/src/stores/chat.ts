import { create as createProto } from "@bufbuild/protobuf";
import { create } from "zustand";
import type { WsClient } from "../api/ws";
import { ListConversationsSchema, OpenDmSchema, type Conversation } from "../gen/v1/conversations_pb";
import type { Envelope } from "../gen/v1/envelope_pb";
import { GetHistorySchema, SendMessageSchema, SyncSchema, type Message } from "../gen/v1/messages_pb";

// Test chat state: DMs, their messages, and what we've seen (lastSeq).
//
// Where messages come from:
//   - get_history: opening a chat (and older pages)
//   - send ack:    my own message, with its server id + seq
//   - push:        someone else's message, live
//   - sync:        what we missed while the socket was down
// They all go through `addMessages`, which dedupes by id and bumps lastSeq.

type Key = string; // conversation id as a string (bigint can't be an object key)

export interface ChatMessage {
  id: bigint; // 0 while pending
  nonce?: string; // my sends: matches the ack
  seq: bigint;
  authorId: bigint;
  text: string;
  pending?: boolean;
  failed?: boolean;
}

interface ChatState {
  conversations: Conversation[];
  messages: Record<Key, ChatMessage[]>; // oldest first
  lastSeq: Record<Key, bigint>; // highest seq we have, per conversation
  selected: bigint | null;
  error: string | null;

  /** Socket (re)connected: listen for pushes, refresh the list, catch up. */
  attach: (ws: WsClient) => Promise<void>;
  openDm: (ws: WsClient, username: string) => Promise<void>;
  select: (ws: WsClient, conversationId: bigint) => Promise<void>;
  send: (ws: WsClient, myId: bigint, text: string) => Promise<void>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const key = (id: bigint): Key => id.toString();
const toChat = (m: Message): ChatMessage => ({ id: m.id, seq: m.seq, authorId: m.authorId, text: dec.decode(m.content) });

export const useChat = create<ChatState>()((set, get) => {
  // Merge into a conversation: replace by id (or by nonce for my pending
  // sends), sort by seq, and remember the highest seq.
  function addMessages(conversationId: bigint, incoming: ChatMessage[]) {
    const k = key(conversationId);
    let list = get().messages[k] ?? [];
    for (const m of incoming) {
      // My own push can arrive before my ack, so a message can match both a
      // pending bubble (by nonce) and a pushed copy (by id). Fold all into one.
      const same = (x: ChatMessage) => (m.id !== 0n && x.id === m.id) || (!!m.nonce && x.nonce === m.nonce);
      const merged = Object.assign({}, ...list.filter(same), m, { pending: m.pending, failed: m.failed });
      list = [...list.filter((x) => !same(x)), merged];
    }
    // Pending ones (seq 0) stay at the bottom.
    list.sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || Number(a.seq - b.seq));
    const seen = incoming.filter((m) => !m.pending).reduce((max, m) => (m.seq > max ? m.seq : max), get().lastSeq[k] ?? 0n);
    set((s) => ({ messages: { ...s.messages, [k]: list }, lastSeq: { ...s.lastSeq, [k]: seen } }));
  }

  // "I have up to lastSeq, what did I miss?" Repeats while the server says
  // there's more; if too much was missed, start over from the newest.
  async function sync(ws: WsClient, conversationId: bigint) {
    const after = get().lastSeq[key(conversationId)] ?? 0n;
    const reply = await ws.request({ case: "sync", value: createProto(SyncSchema, { conversationId, afterSeq: after }) });
    if (reply.case !== "syncResult") return;
    if (!reply.value.complete) {
      // Too far behind: drop the old copy, keep the newest page.
      set((s) => ({ messages: { ...s.messages, [key(conversationId)]: [] } }));
    }
    addMessages(conversationId, reply.value.messages.map(toChat));
  }

  async function loadConversations(ws: WsClient) {
    const reply = await ws.request({ case: "listConversations", value: createProto(ListConversationsSchema) });
    if (reply.case === "conversations") set({ conversations: reply.value.conversations });
  }

  function onPush(payload: Envelope["payload"], ws: WsClient) {
    if (payload.case !== "messageCreated" || !payload.value.message) return;
    const m = payload.value.message;
    const k = key(m.conversationId);
    // A gap (e.g. got 16 but we're at 14)? Ask for what's in between.
    const last = get().lastSeq[k];
    if (last !== undefined && m.seq > last + 1n) void sync(ws, m.conversationId);
    addMessages(m.conversationId, [toChat(m)]);
    // A DM we don't know yet (someone just messaged us first): refresh the list.
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
        // Catch up every chat we already have messages for.
        for (const k of Object.keys(get().lastSeq)) await sync(ws, BigInt(k));
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },

    openDm: async (ws, username) => {
      try {
        const reply = await ws.request({ case: "openDm", value: createProto(OpenDmSchema, { username }) });
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
      // First open: load the newest page. After that, sync keeps it fresh.
      if (get().lastSeq[key(conversationId)] !== undefined) return sync(ws, conversationId);
      const reply = await ws.request({
        case: "getHistory",
        value: createProto(GetHistorySchema, { conversationId, limit: 50 }),
      });
      if (reply.case === "history") addMessages(conversationId, reply.value.messages.map(toChat));
      set((s) => ({ lastSeq: { ...s.lastSeq, [key(conversationId)]: s.lastSeq[key(conversationId)] ?? 0n } }));
    },

    send: async (ws, myId, text) => {
      const conversationId = get().selected;
      if (!conversationId || !text.trim()) return;
      // The nonce makes a retry safe and lets us swap the pending bubble for the real one.
      const nonce = crypto.randomUUID();
      addMessages(conversationId, [{ id: 0n, nonce, seq: 0n, authorId: myId, text, pending: true }]);
      try {
        const reply = await ws.request({
          case: "sendMessage",
          value: createProto(SendMessageSchema, { conversationId, content: enc.encode(text), nonce }),
        });
        if (reply.case === "messageAck" && reply.value.message) {
          addMessages(conversationId, [{ ...toChat(reply.value.message), nonce, pending: false }]);
        }
      } catch (e) {
        addMessages(conversationId, [{ id: 0n, nonce, seq: 0n, authorId: myId, text, pending: true, failed: true }]);
        set({ error: (e as Error).message });
      }
    },
  };
});
