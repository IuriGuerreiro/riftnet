import type { Attachment } from "@/mock/data";

function imageSize(url: string) {
  return new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
    img.onerror = () => resolve({ w: 800, h: 600 });
    img.src = url;
  });
}

function videoSize(url: string) {
  return new Promise<{ w: number; h: number }>((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve({ w: v.videoWidth || 960, h: v.videoHeight || 540 });
    v.onerror = () => resolve({ w: 960, h: 540 });
    v.src = url;
  });
}

export async function toAttachment(file: File): Promise<Attachment> {
  const url = URL.createObjectURL(file);
  if (file.type === "image/gif")
    return { kind: "gif", url, name: file.name, ...(await imageSize(url)) };
  if (file.type.startsWith("image/")) {
    return { kind: "image", url, name: file.name, size: file.size, ...(await imageSize(url)) };
  }
  if (file.type.startsWith("video/")) {
    return { kind: "video", url, name: file.name, size: file.size, ...(await videoSize(url)) };
  }
  return { kind: "file", url, name: file.name, size: file.size };
}
