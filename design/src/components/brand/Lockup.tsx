import { cn } from "@/lib/utils";

import { RiftnetMark } from "./RiftnetMark";
import { Wordmark } from "./Wordmark";

export function Lockup({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <RiftnetMark className="size-7" />
      <Wordmark className="text-sm" />
    </div>
  );
}
