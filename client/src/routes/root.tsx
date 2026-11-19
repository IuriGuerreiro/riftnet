import { Outlet } from "@tanstack/react-router";

export function RootLayout() {
  return (
    <main className="flex h-full items-center justify-center bg-surface-0 p-4 text-fg">
      <Outlet />
    </main>
  );
}
