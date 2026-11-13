import { Outlet } from "@tanstack/react-router";

export function RootLayout() {
  return (
    <main className="flex h-full items-center justify-center bg-zinc-950 p-4 text-zinc-100">
      <Outlet />
    </main>
  );
}
