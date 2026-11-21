import { describe, expect, it } from "vitest";

import { placeCard } from "./position";

const at = (left: number, top: number, size = 40) => ({
  left,
  top,
  right: left + size,
  bottom: top + size,
});

describe("placeCard", () => {
  it("goes right of the anchor when it fits", () => {
    expect(placeCard(at(100, 100), 300, 400, 1200, 800)).toEqual({ left: 148, top: 100 });
  });
  it("flips left near the right edge", () => {
    expect(placeCard(at(1100, 100), 300, 400, 1200, 800)).toEqual({ left: 792, top: 100 });
  });
  it("stays on screen near the bottom", () => {
    expect(placeCard(at(100, 700), 300, 400, 1200, 800).top).toBe(392);
  });
  it("drops below on a narrow screen", () => {
    expect(placeCard(at(20, 50), 300, 400, 360, 800)).toEqual({ left: 20, top: 98 });
  });
});
