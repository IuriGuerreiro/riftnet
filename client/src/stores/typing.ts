import { create as createProto } from "@bufbuild/protobuf";
import { create } from "zustand";
import type { WsClient } from "../api/ws";
import { StartTypingSchema } from "../gen/v1/messages_pb";

// "X is typing…". Ephemeral: nothing is stored, the server only relays.
//
//   - I type → `start_typing` (fire-and-forget), at most once per SEND_EVERY.
//   - Someone else types → `typing_started` push → show them for SHOW_FOR,
//     or until their message arrives.

const SEND_EVERY = 3_000; // matches the server's throttle
const SHOW_FOR = 8_000;

type Key = string; // conversation id as a string

interface TypingState {
  /** conversation → user id (string) → when to stop showing them (ms). */
  typing: Record<Key, Record<string, number>>;
  attach: (ws: WsClient, myId: bigint) => void;
  /** Call on every keystroke; throttled here. */
  typed: (ws: WsClient, conversationId: bigint) => void;
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
    const rest = { ...current };
    delete rest[u];
    set((s) => ({ typing: { ...s.typing, [k]: rest } }));
  }

  function show(conversationId: bigint, userId: bigint) {
    const k = conversationId.toString();
    const u = userId.toString();
    clearTimeout(timers.get(`${k}:${u}`));
    timers.set(`${k}:${u}`, setTimeout(() => remove(conversationId, userId), SHOW_FOR));
    set((s) => ({ typing: { ...s.typing, [k]: { ...s.typing[k], [u]: Date.now() + SHOW_FOR } } }));
  }

  return {
    typing: {},

    attach: (ws, myId) => {
      stopListening?.();
      stopListening = ws.addPushListener((payload) => {
        if (payload.case === "typingStarted" && payload.value.userId !== myId) {
          show(payload.value.conversationId, payload.value.userId);
        }
        // Their message arrived: they're done typing.
        if (payload.case === "messageCreated" && payload.value.message) {
          remove(payload.value.message.conversationId, payload.value.message.authorId);
        }
      });
    },

    typed: (ws, conversationId) => {
      const k = conversationId.toString();
      const now = Date.now();
      if (now - (lastSent.get(k) ?? 0) < SEND_EVERY) return;
      lastSent.set(k, now);
      ws.notify({ case: "startTyping", value: createProto(StartTypingSchema, { conversationId }) });
    },
  };
});

/** "ana is typing…", "ana and bob are typing…", "Several people are typing…". */
export function typingText(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}
