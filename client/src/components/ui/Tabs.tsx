import type { ReactNode } from "react";

import { cn } from "./cn";

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: ReactNode; accent?: boolean }[];
}) {
  return (
    <div role="tablist" className="flex items-center gap-2">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
            item.accent
              ? value === item.value
                ? "bg-transparent text-success"
                : "bg-success text-surface-0 hover:brightness-110"
              : value === item.value
                ? "bg-surface-4 text-fg"
                : "text-fg-muted hover:bg-surface-3 hover:text-fg",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
