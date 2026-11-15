import { create as createProto } from "@bufbuild/protobuf";
import { create } from "zustand";

import type { WsClient } from "../api/ws";
import { StartTypingSchema } from "../gen/v1/messages_pb";

const SEND_EVERY = 3_000;
const SHOW_FOR = 8_000;

type Key = string;

interface TypingState {
  typing: Record<Key, Record<string, number>>;
  attach: (ws: WsClient, myId: bigint) => void;
  typed: (ws: WsClient, conversationId: bigint) => void;
  reset: () => void;
}

export const useTyping = create<TypingState>()((set, get) => {
  let stopListening: (() => void) | undefined;
  const lastSent = new Map<Key, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function remove(conversationId: bigint, userId: bigint) {
    const k = conversationId.toString();
    const u = userId.toString();
    clearTimeout(timers.get(`${k}:${u}`));
    timers.delete(`${k}:${u}`);
    const current = get().typing[k];
    if (!current?.[u]) return;
    const rest = Object.fromEntries(Object.entries(current).filter(([id]) => id !== u));
    set((s) => {
      const others = Object.entries(s.typing).filter(([id]) => id !== k);
      return {
        typing: Object.fromEntries(Object.keys(rest).length ? [...others, [k, rest]] : others),
      };
    });
  }

  function show(conversationId: bigint, userId: bigint) {
    const k = conversationId.toString();
    const u = userId.toString();
    clearTimeout(timers.get(`${k}:${u}`));
    timers.set(
      `${k}:${u}`,
      setTimeout(() => remove(conversationId, userId), SHOW_FOR),
    );
    set((s) => ({ typing: { ...s.typing, [k]: { ...s.typing[k], [u]: Date.now() + SHOW_FOR } } }));
  }

  return {
    typing: {},

    attach: (ws, myId) => {
      get().reset();
      stopListening = ws.addPushListener((payload) => {
        if (payload.case === "typingStarted" && payload.value.userId !== myId) {
          show(payload.value.conversationId, payload.value.userId);
        }
        if (payload.case === "messageCreated" && payload.value.message) {
          remove(payload.value.message.conversationId, payload.value.message.authorId);
        }
      });
    },

    typed: (ws, conversationId) => {
      const k = conversationId.toString();
      const now = Date.now();
      for (const [c, at] of lastSent) if (now - at >= SEND_EVERY) lastSent.delete(c);
      if (now - (lastSent.get(k) ?? 0) < SEND_EVERY) return;
      lastSent.set(k, now);
      ws.notify({ case: "startTyping", value: createProto(StartTypingSchema, { conversationId }) });
    },

    reset: () => {
      stopListening?.();
      stopListening = undefined;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      lastSent.clear();
      set({ typing: {} });
    },
  };
});

export function typingText(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}
