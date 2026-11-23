import { cn } from "@/lib/utils";

const LIGHT_SHARDS = [
  "57,14 57,46 35.5,59 46.2,36.5",
  "53.9,54 30,104 14,104 31.9,66.5",
  "53.2,67 66.8,67 71.6,77 44.6,85",
];
const BRAND_SHARDS = ["63,14 73.5,36 84,58 63,58", "71.4,65 87.4,65 106,104 90,104"];

export function AdeptMark({
  tone = "brand",
  className,
}: {
  tone?: "brand" | "mono";
  className?: string;
}) {
  const light = tone === "brand" ? "#ffffff" : "currentColor";
  const accent = tone === "brand" ? "var(--adept-violet)" : "currentColor";
  return (
    <svg viewBox="10 10 100 100" aria-hidden className={cn("shrink-0", className)}>
      {LIGHT_SHARDS.map((p) => (
        <polygon key={p} points={p} fill={light} />
      ))}
      {BRAND_SHARDS.map((p) => (
        <polygon key={p} points={p} fill={accent} opacity={tone === "mono" ? 0.6 : 1} />
      ))}
    </svg>
  );
}
