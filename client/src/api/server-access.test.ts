import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "./http";
import { forgetServer, isServerUnavailable } from "./server-access";
import { WsError } from "./ws";

vi.mock("../platform", () => ({
  platform: { httpUrl: "http://localhost", wsUrl: "ws://localhost" },
}));
vi.mock("../stores/auth", () => ({ useAuth: {} }));

describe("server access", () => {
  it("clears the affected membership and channel data", () => {
    const client = new QueryClient();
    client.setQueryData(
      ["servers", "user"],
      [
        { id: "removed", name: "First", is_owner: false },
        { id: "kept", name: "Second", is_owner: true },
      ],
    );
    client.setQueryData(["server-channels", "user", "removed"], [{ id: "channel" }]);
    client.setQueryData(["server-members", "user", "removed"], ["member"]);
    client.setQueryData(["server-bans", "user", "removed"], ["banned"]);
    client.setQueryData(["channel-history", "user", "removed", "channel"], ["private"]);
    client.setQueryData(["channel-history", "user", "kept", "other"], ["kept message"]);
    client.setQueryData(["servers", "other-user"], [{ id: "removed" }]);
    forgetServer(client, "user", "removed");
    expect(client.getQueryData(["server-access", "user", "removed"])).toBe(false);
    expect(client.getQueryData(["servers", "user"])).toEqual([
      { id: "kept", name: "Second", is_owner: true },
    ]);
    expect(client.getQueryData(["server-channels", "user", "removed"])).toBeUndefined();
    expect(client.getQueryData(["server-members", "user", "removed"])).toBeUndefined();
    expect(client.getQueryData(["server-bans", "user", "removed"])).toBeUndefined();
    expect(client.getQueryData(["channel-history", "user", "removed", "channel"])).toBeUndefined();
    expect(client.getQueryData(["channel-history", "user", "kept", "other"])).toEqual([
      "kept message",
    ]);
    expect(client.getQueryData(["servers", "other-user"])).toEqual([{ id: "removed" }]);
    client.clear();
  });

  it("recognizes lost access on HTTP and WebSocket operations", () => {
    expect(isServerUnavailable(new ApiError(404, "not_found", "Missing"))).toBe(true);
    expect(isServerUnavailable(new WsError("not_found", "Missing"))).toBe(true);
    expect(isServerUnavailable(new ApiError(500, "internal", "Retry"))).toBe(false);
    expect(isServerUnavailable(new WsError("closed", "Offline"))).toBe(false);
    expect(isServerUnavailable(null)).toBe(false);
  });
});
