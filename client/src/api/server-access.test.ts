import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "./http";
import {
  forgetServer,
  isServerUnavailable,
  reconcileServerAccess,
  refreshServerAccess,
} from "./server-access";
import { listServers } from "./servers";
import { WsError } from "./ws";

vi.mock("./servers", () => ({ listServers: vi.fn() }));

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

describe("server membership recovery", () => {
  it("removes missed memberships and restores access after another device rejoins", () => {
    const client = new QueryClient();
    client.setQueryData(["server-access", "user", "missed"], true);
    client.setQueryData(["channel-history", "user", "missed", "channel"], ["old"]);
    client.setQueryData(["server-access", "user", "rejoined"], false);
    const servers = [{ id: "rejoined", name: "Restored", is_owner: false }];
    client.setQueryData(["servers", "user"], servers);
    reconcileServerAccess(client, "user", servers);
    expect(client.getQueryData(["server-access", "user", "missed"])).toBe(false);
    expect(client.getQueryData(["channel-history", "user", "missed", "channel"])).toBeUndefined();
    expect(client.getQueryData(["server-access", "user", "rejoined"])).toBe(true);
    client.clear();
  });

  it("fetches memberships and invalidates open server data on a new connection", async () => {
    const client = new QueryClient();
    client.setQueryData(["server-access", "user", "server"], false);
    client.setQueryData(["server-channels", "user", "server"], [{ id: "channel" }]);
    vi.mocked(listServers).mockResolvedValueOnce([
      { id: "server", name: "Server", is_owner: false },
    ]);
    await refreshServerAccess(client, "user");
    expect(client.getQueryData(["server-access", "user", "server"])).toBe(true);
    expect(client.getQueryState(["server-channels", "user", "server"])?.isInvalidated).toBe(true);
    client.clear();
  });

  it("keeps known membership data when reconnection reconciliation fails", async () => {
    const client = new QueryClient();
    const servers = [{ id: "server", name: "Server", is_owner: false }];
    client.setQueryData(["servers", "user"], servers);
    client.setQueryData(["server-access", "user", "server"], true);
    vi.mocked(listServers).mockRejectedValueOnce(new Error("offline"));
    await expect(refreshServerAccess(client, "user")).rejects.toThrow("offline");
    expect(client.getQueryData(["server-access", "user", "server"])).toBe(true);
    expect(client.getQueryData(["servers", "user"])).toEqual(servers);
    client.clear();
  });
});
