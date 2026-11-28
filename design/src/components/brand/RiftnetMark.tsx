import mark from "@/assets/brand/riftnet-mark.svg";
import white from "@/assets/brand/riftnet-mark-white.svg";
import { cn } from "@/lib/utils";

export function RiftnetMark({
  tone = "brand",
  className,
}: {
  tone?: "brand" | "mono";
  className?: string;
}) {
  if (tone === "brand")
    return <img src={mark} alt="" aria-hidden className={cn("shrink-0", className)} />;
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{ mask: `url(${white}) center / contain no-repeat` }}
    />
  );
}
