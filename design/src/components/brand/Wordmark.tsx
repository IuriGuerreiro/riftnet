import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      aria-label="Riftnet"
      className={cn(
        "font-display font-bold tracking-[0.32em] -mr-[0.32em] text-foreground select-none",
        className,
      )}
    >
      <span className="text-brand">R</span>IFTNET
    </span>
  );
}
