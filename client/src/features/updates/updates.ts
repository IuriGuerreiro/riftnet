import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";

import { platform } from "../../platform";

export const desktopUpdatesEnabled =
  platform.kind === "desktop" && import.meta.env.VITE_DESKTOP_UPDATES === "1";

type UpdateStatus =
  | { kind: "idle" | "checking" | "current" }
  | { kind: "available"; update: Update }
  | { kind: "installing"; percent: number | null }
  | { kind: "installed"; restartFailed: boolean }
  | { kind: "failed"; message: string };

interface DesktopUpdates {
  status: UpdateStatus;
  checkForUpdate: (background?: boolean) => Promise<void>;
  dismiss: () => void;
  install: () => Promise<void>;
  restart: () => Promise<void>;
}

function releaseResource(update: Update) {
  void update.close().catch(() => {});
}

export const useDesktopUpdates = create<DesktopUpdates>()((set, get) => ({
  status: { kind: "idle" },

  async checkForUpdate(background = false) {
    const { kind } = get().status;
    if (kind !== "idle" && kind !== "current" && kind !== "failed") return;

    set({ status: { kind: "checking" } });
    try {
      const update = await check({ timeout: 15_000 });
      set({ status: update ? { kind: "available", update } : { kind: "current" } });
    } catch {
      set({
        status: background
          ? { kind: "idle" }
          : { kind: "failed", message: "Couldn’t check for updates. Try again." },
      });
    }
  },

  dismiss() {
    const { status } = get();
    if (status.kind === "available") releaseResource(status.update);
    else if (status.kind !== "failed") return;
    set({ status: { kind: "idle" } });
  },

  async install() {
    const { status } = get();
    if (status.kind !== "available") return;
    const { update } = status;
    let total: number | undefined;
    let received = 0;

    set({ status: { kind: "installing", percent: null } });
    try {
      await update.downloadAndInstall(
        (event) => {
          if (get().status.kind !== "installing") return;
          switch (event.event) {
            case "Started":
              total = event.data.contentLength;
              break;
            case "Progress":
              received += event.data.chunkLength;
              if (total) {
                const percent = Math.min(99, Math.floor((received / total) * 100));
                set({ status: { kind: "installing", percent } });
              }
              break;
            case "Finished":
              set({ status: { kind: "installing", percent: 100 } });
              break;
          }
        },
        { timeout: 15 * 60_000 },
      );
      set({ status: { kind: "installed", restartFailed: false } });
    } catch {
      set({
        status: { kind: "failed", message: "Couldn’t install the update. Check again to retry." },
      });
    } finally {
      releaseResource(update);
    }
  },

  async restart() {
    if (get().status.kind !== "installed") return;
    try {
      await relaunch();
    } catch {
      set({ status: { kind: "installed", restartFailed: true } });
    }
  },
}));
