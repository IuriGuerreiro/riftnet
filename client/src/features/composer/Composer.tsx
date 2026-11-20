import { CirclePlus, Paperclip, SendHorizontal, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { formatSize } from "../../api/attachments";
import { IconButton } from "../../components/ui";
import { useChat } from "../../stores/chat";
import { ReplyBar } from "./ReplyBar";
import { useAttachmentUpload } from "./useAttachmentUpload";

const MAX_LEN = 4000;
const MAX_HEIGHT_PX = 240;

export function Composer({
  conversationId,
  placeholder,
  disabled,
  onType,
  onSend,
}: {
  conversationId: bigint;
  placeholder: string;
  disabled: boolean;
  onType: () => void;
  onSend: (text: string, attachmentIds: bigint[]) => void;
}) {
  const [text, setText] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);
  const { files, progress, error, busy, add, removeAt, clear, uploadAll } =
    useAttachmentUpload(conversationId);

  const replying = useChat((s) => s.replyingTo !== null);

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
      className="shrink-0 px-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <ReplyBar conversationId={conversationId} />
      {(files.length > 0 || error !== null || busy) && (
        <div
          className={`flex flex-wrap items-center gap-2 bg-surface-3 px-4 pt-3 text-xs text-fg-muted ${
            replying ? "" : "rounded-t-panel"
          }`}
        >
          {files.map((f, i) => (
            <span
              key={`${f.name}:${f.size}:${f.lastModified}`}
              className="flex items-center gap-1.5 rounded-control bg-surface-1 py-1.5 pl-2.5 pr-1"
            >
              <Paperclip size={14} />
              {f.name} · {formatSize(f.size)}
              {!busy && (
                <IconButton
                  label={`Remove ${f.name}`}
                  size="sm"
                  tone="danger"
                  icon={<X size={14} />}
                  onClick={() => removeAt(i)}
                  className="size-5"
                />
              )}
            </span>
          ))}
          {busy && <span>{progress}</span>}
          {error && <span className="text-danger">{error}</span>}
        </div>
      )}
      <div
        className={`flex items-end gap-1 bg-surface-3 px-2 ${
          replying || files.length > 0 || error !== null || busy
            ? "rounded-b-panel"
            : "rounded-panel"
        }`}
      >
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
        <IconButton
          label="Attach files"
          icon={<CirclePlus size={22} />}
          className="mb-1.5"
          disabled={disabled || busy}
          onClick={() => picker.current?.click()}
        />
        <textarea
          ref={box}
          rows={1}
          value={text}
          aria-label={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) onType();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              useChat.getState().setReplyingTo(null);
            }
          }}
          placeholder={placeholder}
          maxLength={MAX_LEN}
          className="max-h-60 min-w-0 flex-1 resize-none bg-transparent py-3 text-[15px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
        />
        <IconButton
          type="submit"
          label="Send message"
          icon={<SendHorizontal size={20} />}
          disabled={disabled || busy || (!text.trim() && !files.length)}
          className="mb-1.5 hover:text-brand"
        />
      </div>
    </form>
  );
}
