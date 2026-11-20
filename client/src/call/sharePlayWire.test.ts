import { describe, expect, it } from "vitest";

import { decodeTagged, encode, normalizePointer, sendable, wheelLines } from "./sharePlayWire";

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

  it("decodes the SFU sender tag", () => {
    const json = encode({ t: "key", code: "KeyW", down: true });
    const body = new TextEncoder().encode(json);
    const buf = new Uint8Array(8 + body.length);
    new DataView(buf.buffer).setBigUint64(0, 123456789012345678n, false);
    buf.set(body, 8);
    expect(decodeTagged(buf.buffer)).toEqual({ sender: 123456789012345678n, json });
    expect(decodeTagged(new ArrayBuffer(4))).toBeNull();
  });
});
