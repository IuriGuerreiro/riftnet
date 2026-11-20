import { type ReactNode, useId } from "react";

import { cn } from "./cn";

const sides = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
} as const;

export function Tooltip({
  content,
  side = "top",
  children,
}: {
  content: string;
  side?: keyof typeof sides;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <span className="group/tip relative inline-flex" aria-describedby={id}>
      {children}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-surface-0 px-2 py-1 text-xs font-semibold text-fg opacity-0 shadow-pop transition-opacity delay-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100",
          sides[side],
        )}
      >
        {content}
      </span>
    </span>
  );
}
