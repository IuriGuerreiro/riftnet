import { describe, expect, it } from "vitest";

import { readableNameColor } from "./color";

describe("readableNameColor", () => {
  it("keeps bright colors as they are", () => {
    expect(readableNameColor("#ff8800")).toBe("#ff8800");
    expect(readableNameColor("#3ecf8e")).toBe("#3ecf8e");
  });
  it("lightens colors too dark for the dark theme", () => {
    const fixed = readableNameColor("#000000");
    expect(fixed).not.toBe("#000000");
    expect(fixed).toMatch(/^#[0-9a-f]{6}$/);
    expect(readableNameColor("#000080")).not.toBe("#000080");
  });
  it("ignores missing or bad values", () => {
    expect(readableNameColor(null)).toBeUndefined();
    expect(readableNameColor("red")).toBeUndefined();
  });
});
