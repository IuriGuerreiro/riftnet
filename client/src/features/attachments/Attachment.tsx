import { useState } from "react";

import { previewUrl } from "../../api/attachments";
import type { Attachment as AttachmentInfo } from "../../gen/v1/messages_pb";
import { AttachmentChip } from "./AttachmentChip";

export function Attachment({ a, mine }: { a: AttachmentInfo; mine: boolean }) {
  const [now] = useState(() => Date.now());
  const [src, setSrc] = useState(a.previewUrl);
  const [broken, setBroken] = useState(false);
  const [retried, setRetried] = useState(false);
  if (!src || broken || Number(a.expiresAt) <= now) return <AttachmentChip a={a} mine={mine} />;

  // WARN: links last 1h. On failure fetch one fresh link, then fall back to the chip, so no retry loop.
  const onError = async () => {
    if (retried) {
      setBroken(true);
      return;
    }
    setRetried(true);
    try {
      setSrc(await previewUrl(a.id));
    } catch {
      setBroken(true);
    }
  };
  const isVideo = a.contentType.startsWith("video/");
  return (
    <span className="mt-1 block">
      {isVideo ? (
        <video
          src={src}
          controls
          preload="metadata"
          onError={onError}
          className="max-h-80 max-w-full rounded"
        />
      ) : (
        <a href={src} target="_blank" rel="noreferrer noopener">
          <img
            src={src}
            alt={a.filename}
            loading="lazy"
            onError={onError}
            className="max-h-80 max-w-full rounded"
          />
        </a>
      )}
      <AttachmentChip a={a} mine={mine} />
    </span>
  );
}
