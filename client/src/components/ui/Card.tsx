import type { ReactNode } from "react";

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-md space-y-5 rounded-panel bg-surface-2 p-8 shadow-pop">
      {children}
    </div>
  );
}
