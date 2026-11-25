import type { ReactNode } from "react";

import { AdeptLogo } from "./AdeptLogo";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center gap-8 justify-center bg-[radial-gradient(ellipse_at_top,var(--color-surface-3),var(--color-surface-0)_70%)] p-4">
      <AdeptLogo />
      {children}
    </div>
  );
}
