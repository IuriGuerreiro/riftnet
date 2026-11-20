import { Outlet } from "@tanstack/react-router";

export function RootLayout() {
  return (
    <main className="h-full bg-surface-0 text-fg">
      <Outlet />
    </main>
  );
}
