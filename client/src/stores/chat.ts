import { create as createProto } from "@bufbuild/protobuf";
import { create } from "zustand";

import type { WsClient } from "../api/ws";
import {
  AddMemberSchema,
  type Conversation,
  ConversationKind,
  CreateGroupSchema,
  LeaveGroupSchema,
  ListConversationsSchema,
  OpenDmSchema,
  RenameGroupSchema,
} from "../gen/v1/conversations_pb";
import type { Envelope } from "../gen/v1/envelope_pb";
import {
  type Attachment,
  DeleteMessageSchema,
  EditMessageSchema,
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
  editedAt?: bigint;
  attachments?: Attachment[];
  pending?: boolean;
  failed?: boolean;
}

interface ChatState {
  conversations: Conversation[];
  messages: Record<Key, ChatMessage[]>;
  lastSeq: Record<Key, bigint>;
  selected: bigint | null;
  error: string | null;

  attach: (ws: WsClient, myId: bigint) => Promise<void>;
  createGroup: (ws: WsClient, name: string, usernames: string[]) => Promise<void>;
  addMember: (ws: WsClient, username: string) => Promise<void>;
  renameGroup: (ws: WsClient, name: string) => Promise<void>;
  leaveGroup: (ws: WsClient) => Promise<void>;
  openDm: (ws: WsClient, username: string) => Promise<void>;
  select: (ws: WsClient, conversationId: bigint) => Promise<void>;
  send: (ws: WsClient, myId: bigint, text: string, attachmentIds?: bigint[]) => Promise<void>;
  edit: (ws: WsClient, messageId: bigint, text: string) => Promise<boolean>;
  remove: (ws: WsClient, messageId: bigint) => Promise<boolean>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const key = (id: bigint): Key => id.toString();
const toChat = (m: Message): ChatMessage => ({
  id: m.id,
  seq: m.seq,
  authorId: m.authorId,
  text: dec.decode(m.content),
  editedAt: m.editedAt || undefined,
  attachments: m.attachments.length ? m.attachments : undefined,
});

export const isGroup = (c: Conversation) => c.kind === ConversationKind.GROUP;

export const useChat = create<ChatState>()((set, get) => {
  function addMessages(conversationId: bigint, incoming: ChatMessage[]) {
    const k = key(conversationId);
    let list = get().messages[k] ?? [];
    for (const m of incoming) {
      const same = (x: ChatMessage) =>
        (m.id !== 0n && x.id === m.id) || (!!m.nonce && x.nonce === m.nonce);
      const merged = Object.assign({}, ...list.filter(same), m, {
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

  function removeMessages(conversationId: bigint, ids: bigint[]) {
    const k = key(conversationId);
    set((s) => ({
      messages: { ...s.messages, [k]: (s.messages[k] ?? []).filter((m) => !ids.includes(m.id)) },
    }));
  }

  function noteSeq(ws: WsClient, conversationId: bigint, seq: bigint) {
    const k = key(conversationId);
    const last = get().lastSeq[k];
    if (last === undefined) return;
    if (seq > last + 1n) void sync(ws, conversationId);
    else if (seq > last) set((s) => ({ lastSeq: { ...s.lastSeq, [k]: seq } }));
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
    const r = reply.value;
    addMessages(conversationId, [...r.messages, ...r.edited].map(toChat));
    removeMessages(conversationId, r.deletedIds);
    const k = key(conversationId);
    set((s) => ({
      lastSeq: {
        ...s.lastSeq,
        [k]: r.lastSeq > (s.lastSeq[k] ?? 0n) ? r.lastSeq : (s.lastSeq[k] ?? 0n),
      },
    }));
  }

  async function loadConversations(ws: WsClient) {
    const reply = await ws.request({
      case: "listConversations",
      value: createProto(ListConversationsSchema),
    });
    if (reply.case === "conversations") set({ conversations: reply.value.conversations });
  }

  function upsertConversation(c: Conversation, myId: bigint) {
    const stillMember = c.members.some((m) => m.id === myId);
    set((s) => ({
      conversations: stillMember
        ? [c, ...s.conversations.filter((x) => x.id !== c.id)]
        : s.conversations.filter((x) => x.id !== c.id),
      selected: !stillMember && s.selected === c.id ? null : s.selected,
    }));
  }

  async function groupRequest(ws: WsClient, payload: Envelope["payload"]) {
    try {
      const reply = await ws.request(payload);
      if (reply.case === "conversation" && reply.value.conversation)
        upsertConversation(reply.value.conversation, myId);
      set({ error: null });
      return reply;
    } catch (e) {
      set({ error: (e as Error).message });
    }
  }

  let myId = 0n;

  function onPush(payload: Envelope["payload"], ws: WsClient) {
    if (payload.case === "conversationUpdated" && payload.value.conversation) {
      upsertConversation(payload.value.conversation, myId);
      return;
    }
    if (payload.case === "messageUpdated" && payload.value.message) {
      const m = payload.value.message;
      if (get().messages[key(m.conversationId)]?.some((x) => x.id === m.id))
        addMessages(m.conversationId, [toChat(m)]);
      noteSeq(ws, m.conversationId, payload.value.seq);
      return;
    }
    if (payload.case === "messageDeleted") {
      const { conversationId, messageId, seq } = payload.value;
      removeMessages(conversationId, [messageId]);
      noteSeq(ws, conversationId, seq);
      return;
    }
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

    attach: async (ws, me) => {
      myId = me;
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

    createGroup: async (ws, name, usernames) => {
      const reply = await groupRequest(ws, {
        case: "createGroup",
        value: createProto(CreateGroupSchema, { name, usernames }),
      });
      if (reply?.case === "conversation" && reply.value.conversation)
        await get().select(ws, reply.value.conversation.id);
    },

    addMember: async (ws, username) => {
      const conversationId = get().selected;
      if (conversationId)
        await groupRequest(ws, {
          case: "addMember",
          value: createProto(AddMemberSchema, { conversationId, username }),
        });
    },

    renameGroup: async (ws, name) => {
      const conversationId = get().selected;
      if (conversationId)
        await groupRequest(ws, {
          case: "renameGroup",
          value: createProto(RenameGroupSchema, { conversationId, name }),
        });
    },

    leaveGroup: async (ws) => {
      const conversationId = get().selected;
      if (!conversationId) return;
      const reply = await groupRequest(ws, {
        case: "leaveGroup",
        value: createProto(LeaveGroupSchema, { conversationId }),
      });
      if (reply)
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== conversationId),
          selected: null,
        }));
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

    send: async (ws, myId, text, attachmentIds = []) => {
      const conversationId = get().selected;
      if (!conversationId || (!text.trim() && !attachmentIds.length)) return;
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
            attachmentIds,
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

    edit: async (ws, messageId, text) => {
      const conversationId = get().selected;
      if (!conversationId || !text.trim()) return false;
      try {
        const reply = await ws.request({
          case: "editMessage",
          value: createProto(EditMessageSchema, {
            conversationId,
            messageId,
            content: enc.encode(text),
          }),
        });
        if (reply.case === "editMessageAck" && reply.value.message) {
          addMessages(conversationId, [toChat(reply.value.message)]);
          noteSeq(ws, conversationId, reply.value.seq);
        }
        set({ error: null });
        return true;
      } catch (e) {
        set({ error: (e as Error).message });
        return false;
      }
    },

    remove: async (ws, messageId) => {
      const conversationId = get().selected;
      if (!conversationId) return false;
      try {
        const reply = await ws.request({
          case: "deleteMessage",
          value: createProto(DeleteMessageSchema, { conversationId, messageId }),
        });
        removeMessages(conversationId, [messageId]);
        if (reply.case === "deleteMessageAck" && reply.value.seq)
          noteSeq(ws, conversationId, reply.value.seq);
        set({ error: null });
        return true;
      } catch (e) {
        set({ error: (e as Error).message });
        return false;
      }
    },
  };
});
