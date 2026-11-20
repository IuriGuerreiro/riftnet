import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { watchOwnPresence } from "../api/presence-settings";
import { PresenceUpdatedSchema } from "../gen/v1/presence_pb";
import { mergePresenceUpdates, PresenceStatus, usePresence } from "./presence";

const update = (status: PresenceStatus, revision: bigint, userId = 1n) =>
  create(PresenceUpdatedSchema, { userId, status, revision });

describe("presence updates", () => {
  it("keeps invisible when an older online push or snapshot arrives late", () => {
    const hidden = mergePresenceUpdates({ statuses: {}, revisions: {} }, [
      update(PresenceStatus.OFFLINE, 20n),
    ]);
    const late = mergePresenceUpdates(hidden, [update(PresenceStatus.ONLINE, 19n)]);
    expect(late.statuses["1"]).toBe(PresenceStatus.OFFLINE);
    expect(late.revisions["1"]).toBe(20n);
    expect(mergePresenceUpdates(late, [update(PresenceStatus.ONLINE, 21n)]).statuses["1"]).toBe(
      PresenceStatus.ONLINE,
    );
  });

  it("refetches the selector when another device changes our preference, even if visible status stays offline", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    usePresence.setState({ statuses: { "1": PresenceStatus.OFFLINE }, revisions: { "1": 10n } });
    let saved = "online";
    const observer = new QueryObserver(client, {
      queryKey: ["presence-settings", "1"],
      queryFn: () => Promise.resolve(saved),
    });
    const stopObserver = observer.subscribe(() => {});
    const stopWatching = watchOwnPresence(client, "1");
    try {
      await observer.refetch();
      expect(observer.getCurrentResult().data).toBe("online");
      saved = "invisible";
      usePresence.setState((state) =>
        mergePresenceUpdates(state, [update(PresenceStatus.OFFLINE, 11n)]),
      );
      await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe("invisible"));
      saved = "idle";
      usePresence.setState((state) =>
        mergePresenceUpdates(state, [update(PresenceStatus.IDLE, 12n, 2n)]),
      );
      expect(observer.getCurrentResult().data).toBe("invisible");
    } finally {
      stopWatching();
      stopObserver();
      client.clear();
    }
  });
});
