export type InputEvent =
  | { t: "move"; x: number; y: number }
  | { t: "button"; b: number; down: boolean; x: number; y: number }
  | { t: "wheel"; dx: number; dy: number; x: number; y: number }
  | { t: "key"; code: string; down: boolean }
  | { t: "ping" };

export const PING_MS = 500;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MonitorInfo {
  name: string;
  rect: Rect;
}

interface ControlLike {
  hostId: bigint;
  controllerId: bigint;
  granted: boolean;
  grantId: bigint;
  requestId: bigint;
}

export interface HostState {
  armed: bigint | null;
  seen: Set<bigint>;
}

export type HostStep =
  | { kind: "none" }
  | { kind: "revoke" }
  | { kind: "arm"; grantId: bigint; controllerId: bigint; requestId: bigint };

export function hostStep(
  s: HostState,
  control: ControlLike | undefined,
  me: bigint | undefined,
  sharing: boolean,
): HostStep {
  const want =
    control?.granted &&
    control.grantId !== 0n &&
    me !== undefined &&
    control.hostId === me &&
    sharing
      ? control
      : null;
  if (s.armed !== null && want?.grantId !== s.armed) return { kind: "revoke" };
  if (s.armed === null && want && !s.seen.has(want.grantId))
    return {
      kind: "arm",
      grantId: want.grantId,
      controllerId: want.controllerId,
      requestId: want.requestId,
    };
  return { kind: "none" };
}

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

export function encodeInput(e: InputEvent, grantId: bigint): Uint8Array<ArrayBuffer> {
  const body = new TextEncoder().encode(encode(e));
  const packet = new Uint8Array(8 + body.length);
  new DataView(packet.buffer).setBigUint64(0, grantId, false);
  packet.set(body, 8);
  return packet;
}

export interface Tagged {
  sender: bigint;
  grantId: bigint;
  json: string;
}

export function decodeTagged(data: ArrayBuffer): Tagged | null {
  if (data.byteLength < 17) return null;
  const view = new DataView(data);
  return {
    sender: view.getBigUint64(0, false),
    grantId: view.getBigUint64(8, false),
    json: new TextDecoder().decode(new Uint8Array(data, 16)),
  };
}
