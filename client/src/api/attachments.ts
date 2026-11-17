import { createBLAKE3 } from "hash-wasm";

import { ApiError, http } from "./http";

interface AttachmentDto {
  id: string;
  chunk_size: number;
  chunk_count: number;
  status: string;
}

interface DownloadDto {
  url: string;
}

const CHUNK_RETRIES = 3;

async function blake3Hex(blob: Blob, piece = 8 * 1024 * 1024): Promise<string> {
  const h = await createBLAKE3();
  for (let at = 0; at < blob.size; at += piece) {
    h.update(new Uint8Array(await blob.slice(at, at + piece).arrayBuffer()));
  }
  return h.digest("hex");
}

export async function uploadFile(
  conversationId: bigint,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<bigint> {
  const whole = await blake3Hex(file);
  const a = await http<AttachmentDto>("/attachments", {
    method: "POST",
    body: {
      conversation_id: conversationId.toString(),
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size,
      blake3: whole,
    },
  });

  for (let i = 0; i < a.chunk_count; i++) {
    const chunk = file.slice(i * a.chunk_size, (i + 1) * a.chunk_size);
    const hash = await blake3Hex(chunk);
    for (let attempt = 1; ; attempt++) {
      try {
        await http<undefined>(`/attachments/${a.id}/chunks/${i}`, {
          method: "PUT",
          raw: chunk,
          headers: { "x-chunk-blake3": hash },
        });
        break;
      } catch (e) {
        // WARN: retry hash_mismatch (damaged in transit) and 5xx; other 4xx won't fix themselves.
        if (
          attempt >= CHUNK_RETRIES ||
          (e instanceof ApiError && e.status < 500 && e.code !== "hash_mismatch")
        )
          throw e;
      }
    }
    onProgress?.((i + 1) / a.chunk_count);
  }

  await http<AttachmentDto>(`/attachments/${a.id}/complete`, { method: "POST" });
  return BigInt(a.id);
}

export async function downloadFile(id: bigint, filename: string, expected: Uint8Array) {
  const { url } = await http<DownloadDto>(`/attachments/${id}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const blob = await res.blob();

  const got = await blake3Hex(blob);
  const want = Array.from(expected, (b) => b.toString(16).padStart(2, "0")).join("");
  if (got !== want) throw new Error("file is damaged (BLAKE3 doesn't match), not saved");

  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export function formatSize(bytes: bigint | number): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
