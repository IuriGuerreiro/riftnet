import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WsClient } from "../api/ws";
import { ActivitiesSchema } from "../gen/v1/presence_pb";
import { useActivity } from "./activity";

const reply = (label = "Minecraft") => ({
  case: "activities" as const,
  value: create(ActivitiesSchema, {
    activities: [{ userId: 2n, label, streaming: true, joinable: true }],
  }),
});

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

describe("friend activity", () => {
  it("replaces revoked activity on the next read", async () => {
    vi.useFakeTimers();
    let removed = false;
    const ws: Pick<WsClient, "request"> = {
      request: () =>
        Promise.resolve(
          removed ? { case: "activities", value: create(ActivitiesSchema) } : reply(),
        ),
    };
    stop = useActivity.getState().watch(ws, ["2"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(useActivity.getState().byId["2"]?.label).toBe("Minecraft");
    removed = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useActivity.getState().byId).toEqual({});
  });

  it("clears stale data even if a subsequent request hangs", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const ws: Pick<WsClient, "request"> = {
      request: () => (++reads === 1 ? Promise.resolve(reply()) : new Promise(() => {})),
    };
    stop = useActivity.getState().watch(ws, ["2"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(useActivity.getState().byId["2"]).toBeDefined();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(useActivity.getState().byId).toEqual({});
  });

  it("ignores an old connection's response after switching accounts", async () => {
    let resolve: ((value: ReturnType<typeof reply>) => void) | undefined;
    const ws: Pick<WsClient, "request"> = {
      request: () =>
        new Promise((done) => {
          resolve = done;
        }),
    };
    const oldStop = useActivity.getState().watch(ws, ["2"]);
    oldStop();
    stop = useActivity
      .getState()
      .watch({ request: () => Promise.resolve(reply("New game")) }, ["2"]);
    await Promise.resolve();
    resolve?.(reply("Old game"));
    await Promise.resolve();
    expect(useActivity.getState().byId["2"]?.label).toBe("New game");
  });
});
