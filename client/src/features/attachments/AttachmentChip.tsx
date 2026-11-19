import { Paperclip } from "lucide-react";
import { useState } from "react";

import { downloadFile, formatSize } from "../../api/attachments";
import type { Attachment as AttachmentInfo } from "../../gen/v1/messages_pb";

export function AttachmentChip({ a, mine }: { a: AttachmentInfo; mine: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState("");
  const [now] = useState(() => Date.now());
  const expired = Number(a.expiresAt) <= now;
  return (
    <button
      type="button"
      disabled={expired || state === "busy"}
      onClick={async () => {
        setState("busy");
        try {
          await downloadFile(a.id, a.filename, a.blake3);
          setState("idle");
        } catch (e) {
          setError((e as Error).message);
          setState("error");
        }
      }}
      title={expired ? "expired" : error || "download"}
      className={`mt-1 flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs ${
        mine ? "border-on-brand/30" : "border-line-strong"
      } ${expired ? "opacity-50 line-through" : "hover:underline"}`}
    >
      <Paperclip size={14} className="shrink-0" />
      <span className="truncate">{a.filename}</span>
      <span className="ml-auto shrink-0 opacity-70">
        {expired
          ? "expired"
          : state === "busy"
            ? "downloading…"
            : state === "error"
              ? "failed"
              : formatSize(a.size)}
      </span>
    </button>
  );
}
