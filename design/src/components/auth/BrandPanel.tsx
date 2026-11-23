import { useState } from "react";

import { AdeptMorph } from "@/components/brand/AdeptMorph";
import { cn } from "@/lib/utils";

const CAPTIONS = [
  { tag: "Adept", line: "One place for the people you play with." },
  { tag: "Voice", line: "Talk like you're in the same room." },
  { tag: "Screen", line: "Share your screen in one click." },
  { tag: "Play", line: "Squad up and play together." },
] as const;

export function BrandPanel({ className }: { className?: string }) {
  const [state, setState] = useState(0);
  const caption = CAPTIONS[state] ?? CAPTIONS[0];

  return (
    <aside
      className={cn(
        "relative isolate flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/5 bg-ink",
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_42%,color-mix(in_srgb,var(--adept-violet)_22%,transparent),transparent_60%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.07] [background-image:linear-gradient(var(--foreground)_1px,transparent_1px),linear-gradient(90deg,var(--foreground)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(circle_at_50%_45%,black,transparent_70%)]"
      />

      <AdeptMorph size={280} onStateChange={setState} />

      <div className="mt-10 flex h-20 flex-col items-center gap-3 text-center">
        <p
          key={caption.tag}
          className="animate-in fade-in slide-in-from-bottom-1 text-[11px] font-semibold tracking-[0.3em] text-brand uppercase duration-500"
        >
          {caption.tag}
        </p>
        <p
          key={caption.line}
          className="animate-in fade-in slide-in-from-bottom-2 max-w-xs text-xl font-medium text-balance text-foreground duration-500"
        >
          {caption.line}
        </p>
      </div>

      <div className="mt-6 flex gap-2" aria-hidden>
        {CAPTIONS.map((c, i) => (
          <span
            key={c.tag}
            className={cn(
              "h-1.5 rounded-full transition-all duration-500",
              i === state ? "w-6 bg-brand" : "w-1.5 bg-white/20",
            )}
          />
        ))}
      </div>
    </aside>
  );
}
