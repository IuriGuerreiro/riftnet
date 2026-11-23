import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";

export function SpeakingAvatar({
  id,
  size,
  speaking,
  ringBg = "var(--surface-1)",
}: {
  id: string;
  size: number;
  speaking: boolean;
  ringBg?: string;
}) {
  return (
    <span
      className={cn("rounded-full transition-shadow duration-150 motion-reduce:transition-none")}
      style={{
        boxShadow: speaking
          ? `0 0 0 2px ${ringBg}, 0 0 0 4px var(--success)`
          : `0 0 0 2px ${ringBg}`,
      }}
    >
      <Avatar id={id} size={size} />
    </span>
  );
}
