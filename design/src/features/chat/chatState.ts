import { type Attachment, ME, type Message } from "@/mock/data";

export interface ChatState {
  messages: Message[];
  replyTo: string | null;
  editing: string | null;
  unreadFrom: string | null;
  sent: number;
  older: number;
}

export type ChatAction =
  | { type: "send"; text: string; attachments?: Attachment[] }
  | { type: "prepend"; messages: Message[] }
  | { type: "receive"; message: Message }
  | { type: "delivered"; id: string; ok: boolean }
  | { type: "retry"; id: string }
  | { type: "edit"; id: string; text: string }
  | { type: "delete"; id: string }
  | { type: "react"; id: string; emoji: string }
  | { type: "pin"; id: string }
  | { type: "reply"; id: string | null }
  | { type: "startEdit"; id: string | null }
  | { type: "markUnread"; id: string | null };

export function clock(d = new Date()) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function initChat({ messages, unread }: { messages: Message[]; unread: number }): ChatState {
  const first = unread > 0 ? messages.at(-Math.min(unread, messages.length)) : undefined;
  return {
    messages,
    replyTo: null,
    editing: null,
    unreadFrom: first?.id ?? null,
    sent: 0,
    older: messages.length > 0 ? 2 : 0,
  };
}

const patch = (state: ChatState, id: string, fn: (m: Message) => Message): ChatState => ({
  ...state,
  messages: state.messages.map((m) => (m.id === id ? fn(m) : m)),
});

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send": {
      const msg: Message = {
        id: `local-${state.sent}`,
        author: ME,
        text: action.text,
        time: clock(),
        attachments: action.attachments,
        replyTo: state.replyTo ?? undefined,
        status: "sending",
      };
      return {
        ...state,
        messages: [...state.messages, msg],
        replyTo: null,
        unreadFrom: null,
        sent: state.sent + 1,
      };
    }
    case "prepend":
      return {
        ...state,
        messages: [...action.messages, ...state.messages],
        older: state.older - 1,
      };
    case "receive":
      return { ...state, messages: [...state.messages, action.message] };
    case "delivered":
      return patch(state, action.id, (m) => ({ ...m, status: action.ok ? undefined : "failed" }));
    case "retry":
      return patch(state, action.id, (m) => ({ ...m, status: "sending" }));
    case "edit":
      return {
        ...patch(state, action.id, (m) =>
          m.text === action.text ? m : { ...m, text: action.text, edited: true },
        ),
        editing: null,
      };
    case "delete":
      return {
        ...state,
        editing: state.editing === action.id ? null : state.editing,
        replyTo: state.replyTo === action.id ? null : state.replyTo,
        unreadFrom: state.unreadFrom === action.id ? null : state.unreadFrom,
        messages: state.messages.filter((m) => m.id !== action.id),
      };
    case "react":
      return patch(state, action.id, (m) => {
        const reactions = m.reactions ?? [];
        const hit = reactions.find((r) => r.emoji === action.emoji);
        if (!hit)
          return { ...m, reactions: [...reactions, { emoji: action.emoji, count: 1, mine: true }] };
        const count = hit.count + (hit.mine ? -1 : 1);
        return {
          ...m,
          reactions: reactions.flatMap((r) =>
            r !== hit ? [r] : count > 0 ? [{ ...r, count, mine: !r.mine }] : [],
          ),
        };
      });
    case "pin":
      return patch(state, action.id, (m) => ({ ...m, pinned: !m.pinned }));
    case "reply":
      return { ...state, replyTo: action.id, editing: null };
    case "startEdit":
      return { ...state, editing: action.id, replyTo: action.id ? null : state.replyTo };
    case "markUnread":
      return { ...state, unreadFrom: action.id };
  }
}

export function lastOwnMessage(state: ChatState) {
  return state.messages.findLast(
    (m) => !m.system && m.author === ME && m.text && m.status !== "failed",
  );
}
