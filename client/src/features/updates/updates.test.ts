import { check, Update } from "@tauri-apps/plugin-updater";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDesktopUpdates } from "./updates";

vi.mock("../../platform", () => ({ platform: { kind: "desktop" } }));
vi.mock("@tauri-apps/plugin-updater", { spy: true });

function offerUpdate() {
  const update = new Update({ rid: 1, currentVersion: "0.1.0", version: "0.1.1", rawJson: {} });
  const download = vi.spyOn(update, "downloadAndInstall").mockResolvedValue();
  const close = vi.spyOn(update, "close").mockResolvedValue();
  vi.mocked(check).mockResolvedValueOnce(update);
  return { download, close };
}

describe("desktop updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDesktopUpdates.setState({ status: { kind: "idle" } });
  });

  it("does not download after a check or after choosing Later", async () => {
    const { download, close } = offerUpdate();
    const { checkForUpdate, dismiss, install } = useDesktopUpdates.getState();

    await Promise.all([checkForUpdate(true), checkForUpdate(true)]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(useDesktopUpdates.getState().status.kind).toBe("available");
    expect(download).not.toHaveBeenCalled();

    dismiss();
    await install();
    expect(download).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("installs once after consent and reports that restart is ready", async () => {
    const { download, close } = offerUpdate();
    const { checkForUpdate, install } = useDesktopUpdates.getState();

    await checkForUpdate();
    await Promise.all([install(), install()]);

    expect(download).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(useDesktopUpdates.getState().status.kind).toBe("installed");
  });

  it("lets the user check again after an install fails", async () => {
    const first = offerUpdate();
    first.download.mockRejectedValueOnce(new Error("invalid signature"));
    const { checkForUpdate, install } = useDesktopUpdates.getState();

    await checkForUpdate();
    await install();
    expect(first.close).toHaveBeenCalledOnce();
    expect(useDesktopUpdates.getState().status.kind).toBe("failed");

    offerUpdate();
    await checkForUpdate();
    expect(useDesktopUpdates.getState().status.kind).toBe("available");
  });
});
