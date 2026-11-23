import { type Attachment, ME, type Message } from "@/mock/data";

export interface ChatState {
  messages: Message[];
  replyTo: string | null;
  editing: string | null;
  sent: number;
}

export type ChatAction =
  | { type: "send"; text: string; attachments?: Attachment[] }
  | { type: "edit"; id: string; text: string }
  | { type: "delete"; id: string }
  | { type: "reply"; id: string | null }
  | { type: "startEdit"; id: string | null };

function now() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function initChat(messages: Message[]): ChatState {
  return { messages, replyTo: null, editing: null, sent: 0 };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send": {
      const msg: Message = {
        id: `local-${state.sent}`,
        author: ME,
        text: action.text,
        time: now(),
        attachments: action.attachments,
        replyTo: state.replyTo ?? undefined,
      };
      return { ...state, messages: [...state.messages, msg], replyTo: null, sent: state.sent + 1 };
    }
    case "edit":
      return {
        ...state,
        editing: null,
        messages: state.messages.map((m) =>
          m.id === action.id && m.text !== action.text
            ? { ...m, text: action.text, edited: true }
            : m,
        ),
      };
    case "delete":
      return {
        ...state,
        editing: state.editing === action.id ? null : state.editing,
        replyTo: state.replyTo === action.id ? null : state.replyTo,
        messages: state.messages.filter((m) => m.id !== action.id),
      };
    case "reply":
      return { ...state, replyTo: action.id, editing: null };
    case "startEdit":
      return { ...state, editing: action.id, replyTo: action.id ? null : state.replyTo };
  }
}

export function lastOwnMessage(state: ChatState) {
  return state.messages.findLast((m) => m.author === ME && m.text);
}
