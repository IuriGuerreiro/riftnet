import { cn } from "@/lib/utils";
import type { Server } from "@/mock/data";

export function ServerIcon({
  server,
  size = 48,
  active = false,
  className,
}: {
  server: Server;
  size?: number;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center font-display font-bold text-white transition-[border-radius] duration-200 select-none",
        active ? "rounded-[30%]" : "rounded-[38%]",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.3,
        background: `linear-gradient(150deg, hsl(${server.hue} 45% 34%), hsl(${server.hue + 20} 40% 22%))`,
      }}
    >
      {server.short}
    </span>
  );
}
