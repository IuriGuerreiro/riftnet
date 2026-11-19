import { useState } from "react";

import { uploadFile } from "../../api/attachments";

const MAX_FILES = 10;

export function useAttachmentUpload(conversationId: bigint) {
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = (more: File[]) => setFiles((cur) => [...cur, ...more].slice(0, MAX_FILES));
  const removeAt = (i: number) => setFiles((cur) => cur.filter((_, j) => j !== i));
  const clear = () => setFiles([]);

  async function uploadAll(): Promise<bigint[] | null> {
    setError(null);
    const ids: bigint[] = [];
    try {
      for (const [i, f] of files.entries()) {
        setProgress(`uploading ${i + 1}/${files.length} · hashing…`);
        ids.push(
          await uploadFile(conversationId, f, (p) =>
            setProgress(`uploading ${i + 1}/${files.length} · ${Math.round(p * 100)}%`),
          ),
        );
      }
      return ids;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setProgress(null);
    }
  }

  return { files, progress, error, busy: progress !== null, add, removeAt, clear, uploadAll };
}
