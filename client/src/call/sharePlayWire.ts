export type InputEvent =
  | { t: "move"; x: number; y: number }
  | { t: "button"; b: number; down: boolean }
  | { t: "wheel"; dx: number; dy: number }
  | { t: "key"; code: string; down: boolean };

export const RELIABLE = "input";
export const LATEST = "input-move";

export const REVOKE_HOTKEY_LABEL = "Ctrl+Shift+F12";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function normalizePointer(
  clientX: number,
  clientY: number,
  box: Box,
  videoWidth: number,
  videoHeight: number,
): { x: number; y: number } | null {
  if (!box.width || !box.height || !videoWidth || !videoHeight) return null;
  const scale = Math.min(box.width / videoWidth, box.height / videoHeight);
  const w = videoWidth * scale;
  const h = videoHeight * scale;
  const x = (clientX - box.left - (box.width - w) / 2) / w;
  const y = (clientY - box.top - (box.height - h) / 2) / h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

export function wheelLines(delta: number, mode: number): number {
  const lines = mode === 0 ? delta / 100 : mode === 1 ? delta : delta * 10;
  const r = Math.trunc(lines) || Math.sign(lines);
  return Math.max(-10, Math.min(10, r));
}

export function sendable(code: string): boolean {
  return !/^(Meta|OS)(Left|Right)$/.test(code);
}

export function encode(e: InputEvent): string {
  return JSON.stringify(e);
}

export function decodeTagged(data: ArrayBuffer): { sender: bigint; json: string } | null {
  if (data.byteLength < 9) return null;
  const sender = new DataView(data).getBigUint64(0, false);
  return { sender, json: new TextDecoder().decode(new Uint8Array(data, 8)) };
}
