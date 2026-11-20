import { cn } from "./cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("block animate-pulse rounded-md bg-surface-3", className)} />
  );
}
