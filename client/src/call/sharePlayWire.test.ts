import { describe, expect, it } from "vitest";

import {
  decodeTagged,
  encode,
  type HostState,
  hostStep,
  normalizePointer,
  sendable,
  wheelLines,
} from "./sharePlayWire";

describe("normalizePointer", () => {
  const box = { left: 100, top: 50, width: 800, height: 450 };

  it("maps corners and center when the video fills the box", () => {
    expect(normalizePointer(100, 50, box, 1920, 1080)).toEqual({ x: 0, y: 0 });
    expect(normalizePointer(900, 500, box, 1920, 1080)).toEqual({ x: 1, y: 1 });
    expect(normalizePointer(500, 275, box, 1920, 1080)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("accounts for letterboxing and ignores the bars", () => {
    expect(normalizePointer(200, 50, box, 1024, 768)).toEqual({ x: 0, y: 0 });
    expect(normalizePointer(800, 500, box, 1024, 768)).toEqual({ x: 1, y: 1 });
    expect(normalizePointer(150, 200, box, 1024, 768)).toBeNull();
  });

  it("returns null before the video has a size", () => {
    expect(normalizePointer(500, 275, box, 0, 0)).toBeNull();
  });
});

describe("wheelLines", () => {
  it("converts pixels, lines and pages", () => {
    expect(wheelLines(100, 0)).toBe(1);
    expect(wheelLines(-30, 0)).toBe(-1);
    expect(wheelLines(3, 1)).toBe(3);
    expect(wheelLines(5, 2)).toBe(10);
    expect(wheelLines(0, 0)).toBe(0);
  });
});

describe("wire format", () => {
  it("never sends the OS key", () => {
    expect(sendable("MetaLeft")).toBe(false);
    expect(sendable("OSRight")).toBe(false);
    expect(sendable("KeyW")).toBe(true);
  });

  it("decodes the SFU sender and grant tag", () => {
    const json = encode({ t: "key", code: "KeyW", down: true });
    const body = new TextEncoder().encode(json);
    const buf = new Uint8Array(16 + body.length);
    new DataView(buf.buffer).setBigUint64(0, 123456789012345678n, false);
    new DataView(buf.buffer).setBigUint64(8, 900n, false);
    buf.set(body, 16);
    expect(decodeTagged(buf.buffer)).toEqual({ sender: 123456789012345678n, grantId: 900n, json });
    expect(decodeTagged(new ArrayBuffer(16))).toBeNull();
  });

  it("encodes moves the way the SFU's move-only channel expects", () => {
    expect(encode({ t: "move", x: 0.5, y: 0.25 }).startsWith('{"t":"move",')).toBe(true);
  });
});

describe("hostStep", () => {
  const me = 1n;
  const grant = { hostId: me, controllerId: 2n, granted: true, grantId: 900n, requestId: 300n };
  const fresh = (): HostState => ({ armed: null, seen: new Set() });

  it("arms a new grant once", () => {
    expect(hostStep(fresh(), grant, me, true)).toEqual({
      kind: "arm",
      grantId: 900n,
      controllerId: 2n,
      requestId: 300n,
    });
    expect(hostStep({ armed: 900n, seen: new Set([900n]) }, grant, me, true)).toEqual({
      kind: "none",
    });
  });

  it("never re-arms a grant id it has seen (stale update after revoke)", () => {
    expect(hostStep({ armed: null, seen: new Set([900n]) }, grant, me, true)).toEqual({
      kind: "none",
    });
  });

  it("revokes when the grant goes away, changes, or the share stops", () => {
    const armed = { armed: 900n, seen: new Set([900n]) };
    expect(hostStep(armed, undefined, me, true)).toEqual({ kind: "revoke" });
    expect(hostStep(armed, { ...grant, grantId: 901n }, me, true)).toEqual({ kind: "revoke" });
    expect(hostStep(armed, grant, me, false)).toEqual({ kind: "revoke" });
  });

  it("ignores pending requests and other hosts", () => {
    expect(hostStep(fresh(), { ...grant, granted: false, grantId: 0n }, me, true)).toEqual({
      kind: "none",
    });
    expect(hostStep(fresh(), { ...grant, hostId: 3n }, me, true)).toEqual({ kind: "none" });
  });
});
