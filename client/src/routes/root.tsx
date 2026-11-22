import { Outlet } from "@tanstack/react-router";

import { DesktopUpdateBanner } from "../features/updates/DesktopUpdates";

export function RootLayout() {
  return (
    <main className="flex h-full flex-col bg-surface-0 text-fg">
      <DesktopUpdateBanner />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </main>
  );
}
