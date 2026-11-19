import { useRef, useState } from "react";

import { formatSize } from "../../api/attachments";
import { useChat } from "../../stores/chat";
import { ReplyBar } from "./ReplyBar";
import { useAttachmentUpload } from "./useAttachmentUpload";

export function Composer({
  conversationId,
  disabled,
  onType,
  onSend,
}: {
  conversationId: bigint;
  disabled: boolean;
  onType: () => void;
  onSend: (text: string, attachmentIds: bigint[]) => void;
}) {
  const [text, setText] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const { files, progress, error, busy, add, removeAt, clear, uploadAll } =
    useAttachmentUpload(conversationId);

  async function submit() {
    if (!text.trim() && !files.length) return;
    const ids = await uploadAll();
    if (!ids) return;
    onSend(text, ids);
    setText("");
    clear();
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-zinc-800 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <ReplyBar conversationId={conversationId} />
      {(files.length > 0 || error !== null || busy) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          {files.map((f, i) => (
            <span
              key={`${f.name}:${f.size}:${f.lastModified}`}
              className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1"
            >
              📎 {f.name} · {formatSize(f.size)}
              {!busy && (
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="ml-1 hover:text-red-400"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          {busy && <span>{progress}</span>}
          {error && <span className="text-red-400">{error}</span>}
        </div>
      )}
      <div className="flex gap-2">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => picker.current?.click()}
          title="Attach files"
          className="rounded-lg bg-zinc-800 px-3 text-lg disabled:opacity-50"
        >
          +
        </button>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) onType();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") useChat.getState().setReplyingTo(null);
          }}
          placeholder="Message"
          maxLength={4000}
          className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none ring-brand focus:ring-2"
        />
        <button
          disabled={disabled || busy}
          className="rounded-lg bg-brand px-4 font-semibold text-zinc-950 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </form>
  );
}
