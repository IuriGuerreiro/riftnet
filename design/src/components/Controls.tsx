import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-4 py-2.5 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span
        className={cn(
          "h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors",
          on ? "bg-brand-fill" : "bg-surface-4",
        )}
      >
        <span
          className={cn(
            "block size-5 rounded-full bg-white transition-transform",
            on && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="py-2.5">
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            onClick={() => onChange(id)}
            className={cn(
              "h-8 rounded-lg border px-3 text-xs font-medium",
              value === id
                ? "border-brand bg-brand/15 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Slider({
  label,
  value,
  max = 200,
  min = 0,
  unit = "%",
  onChange,
}: {
  label: string;
  value: number;
  max?: number;
  min?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block py-2">
      <span className="flex justify-between text-sm font-medium">
        {label}
        <span className="text-xs text-muted-foreground tabular-nums">
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-brand"
      />
    </label>
  );
}

export function Pick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block py-2">
      <span className="text-sm font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-9 w-full rounded-lg border border-input bg-surface-2 px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      {title && (
        <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </h3>
      )}
      <div className="rounded-xl border border-border bg-surface-1 px-4 py-1.5">{children}</div>
    </section>
  );
}
