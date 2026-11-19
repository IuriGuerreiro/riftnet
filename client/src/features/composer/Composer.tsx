import { CirclePlus, Paperclip, SendHorizontal, X } from "lucide-react";
import { useRef, useState } from "react";

import { formatSize } from "../../api/attachments";
import { IconButton } from "../../components/ui";
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
      className="flex flex-col gap-2 border-t border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <ReplyBar conversationId={conversationId} />
      {(files.length > 0 || error !== null || busy) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          {files.map((f, i) => (
            <span
              key={`${f.name}:${f.size}:${f.lastModified}`}
              className="flex items-center gap-1.5 rounded-control bg-surface-3 py-1 pl-2 pr-1"
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
      <div className="flex items-center gap-1 rounded-control bg-surface-3 px-1.5">
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
          icon={<CirclePlus size={20} />}
          disabled={disabled || busy}
          onClick={() => picker.current?.click()}
        />
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
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
        <IconButton
          type="submit"
          label="Send"
          icon={<SendHorizontal size={20} />}
          disabled={disabled || busy}
          className="hover:text-brand"
        />
      </div>
    </form>
  );
}
