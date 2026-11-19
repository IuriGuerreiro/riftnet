import { describe, expect, it } from "vitest";

import { applyReaction, reactorsText } from "./reactions";

const ME = 1n;
const BOB = 2n;

describe("applyReaction", () => {
  it("adds a new chip and marks it mine", () => {
    expect(
      applyReaction(undefined, { emoji: "👍", count: 1, added: true, userId: ME }, ME),
    ).toEqual([{ emoji: "👍", count: 1, me: true }]);
  });

  it("keeps my flag when someone else reacts", () => {
    const chips = [{ emoji: "👍", count: 1, me: true }];
    expect(applyReaction(chips, { emoji: "👍", count: 2, added: true, userId: BOB }, ME)).toEqual([
      { emoji: "👍", count: 2, me: true },
    ]);
  });

  it("clears my flag when I remove, and drops the chip at zero", () => {
    const chips = [{ emoji: "👍", count: 2, me: true }];
    const after = applyReaction(chips, { emoji: "👍", count: 1, added: false, userId: ME }, ME);
    expect(after).toEqual([{ emoji: "👍", count: 1, me: false }]);
    expect(applyReaction(after, { emoji: "👍", count: 0, added: false, userId: BOB }, ME)).toEqual(
      [],
    );
  });

  it("is idempotent (ack + push for the same change)", () => {
    const ev = { emoji: "🎉", count: 1, added: true, userId: ME };
    const once = applyReaction([], ev, ME);
    expect(applyReaction(once, ev, ME)).toEqual(once);
  });
});

describe("reactorsText", () => {
  it("joins names", () => {
    expect(reactorsText(["Ana"], 1)).toBe("Ana");
    expect(reactorsText(["Ana", "Bo"], 2)).toBe("Ana and Bo");
    expect(reactorsText(["Ana", "Bo", "Cy"], 3)).toBe("Ana, Bo and Cy");
    expect(reactorsText(["Ana", "Bo", "Cy", "Di"], 5)).toBe("Ana, Bo, Cy and 2 others");
  });
});
