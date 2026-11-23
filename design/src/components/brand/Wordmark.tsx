import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      aria-label="Adept"
      className={cn(
        "font-display font-bold tracking-[0.42em] -mr-[0.42em] text-foreground select-none",
        className,
      )}
    >
      <span className="text-brand">A</span>DEPT
    </span>
  );
}
