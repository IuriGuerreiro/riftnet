import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../../stores/chat";
import { groupMessages } from "./groupMessages";

const EPOCH = 1_767_225_600_000;
const idAt = (ms: number) => BigInt(ms - EPOCH) << 22n;
const T0 = Date.UTC(2026, 10, 19, 12, 0);
const msg = (author: bigint, ms: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: idAt(ms),
  seq: 0n,
  authorId: author,
  text: "hi",
  ...extra,
});

describe("groupMessages", () => {
  it("groups consecutive messages from the same author", () => {
    const out = groupMessages([msg(1n, T0), msg(1n, T0 + 60_000), msg(2n, T0 + 120_000)]);
    expect(out.map((l) => l.header)).toEqual([true, false, true]);
  });

  it("starts a new group after a long gap", () => {
    const out = groupMessages([msg(1n, T0), msg(1n, T0 + 10 * 60_000)]);
    expect(out[1]?.header).toBe(true);
  });

  it("always shows a header for replies", () => {
    const out = groupMessages([msg(1n, T0), msg(1n, T0 + 1000, { replyTo: 5n })]);
    expect(out[1]?.header).toBe(true);
  });

  it("marks day changes", () => {
    const out = groupMessages([msg(1n, T0), msg(1n, T0 + 24 * 3_600_000)]);
    expect(out.map((l) => l.dayDivider)).toEqual([true, true]);
  });
});
