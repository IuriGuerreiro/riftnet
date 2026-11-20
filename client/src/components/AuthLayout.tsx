import type { ReactNode } from "react";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,var(--color-surface-3),var(--color-surface-0)_70%)] p-4">
      {children}
    </div>
  );
}
