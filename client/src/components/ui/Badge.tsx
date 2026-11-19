import type { ReactNode } from "react";

import { cn } from "./cn";

const tones = {
  brand: "bg-brand text-on-brand",
  danger: "bg-danger text-white",
  neutral: "bg-surface-4 text-fg",
} as const;

export function Badge({
  tone = "danger",
  children,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
