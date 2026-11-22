import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ChannelMessageSchema } from "../gen/v1/messages_pb";
import { pickAuthorName } from "./serverNames";

const EPOCH = 1_767_225_600_000n;
const idAt = (ms: number) => (BigInt(ms) - EPOCH) << 22n;

describe("pickAuthorName", () => {
  const msg = (ms: number) =>
    create(ChannelMessageSchema, { id: idAt(ms), authorId: 1n, authorName: "Ace" });

  it("uses the live name for messages sent before the change", () => {
    expect(pickAuthorName(msg(1_780_000_000_000), { name: "Al", at: 1_790_000_000_000 })).toBe(
      "Al",
    );
  });
  it("trusts the message's own name for messages sent after it", () => {
    expect(pickAuthorName(msg(1_800_000_000_000), { name: "Al", at: 1_790_000_000_000 })).toBe(
      "Ace",
    );
  });
  it("falls back to the message name with no live change", () => {
    expect(pickAuthorName(msg(1_800_000_000_000), undefined)).toBe("Ace");
  });
});
