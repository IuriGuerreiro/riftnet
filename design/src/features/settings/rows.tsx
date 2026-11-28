import { Undo2 } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { DEFAULT_SETTINGS, saveSettings, type Settings, world } from "@/mock/world";

type KeyOf<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      {title && <h3 className="mb-2.5 px-4 text-[15px] font-semibold">{title}</h3>}
      <div className="divide-y divide-white/[0.04] rounded-xl bg-white/[0.03]">{children}</div>
    </section>
  );
}

export function Row({
  label,
  hint,
  k,
  children,
}: {
  label: string;
  hint?: string;
  k?: keyof Settings;
  children?: ReactNode;
}) {
  const changed = k !== undefined && world.settings[k] !== DEFAULT_SETTINGS[k];
  return (
    <div
      data-setting={label}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 data-[found]:bg-brand/15"
    >
      <div className="min-w-48 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {label}
          {changed && (
            <button
              type="button"
              aria-label={`Reset ${label}`}
              title="Reset to default"
              onClick={() => saveSettings({ [k]: DEFAULT_SETTINGS[k] })}
              className="text-muted-foreground hover:text-foreground"
            >
              <Undo2 className="size-3.5" />
            </button>
          )}
        </p>
        {hint && <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function SwitchRow({ k, label, hint }: { k: KeyOf<boolean>; label: string; hint: string }) {
  const on = world.settings[k];
  return (
    <Row label={label} hint={hint} k={k}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => saveSettings({ [k]: !on })}
        className={cn(
          "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand",
          on ? "bg-brand-fill" : "bg-surface-4",
        )}
      >
        <span
          className={cn(
            "block size-4 rounded-full bg-white transition-transform",
            on && "translate-x-4",
          )}
        />
      </button>
    </Row>
  );
}

export function SelectRow({
  k,
  label,
  hint,
  options,
}: {
  k: KeyOf<string>;
  label: string;
  hint: string;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <Row label={label} hint={hint} k={k}>
      <SelectBox
        label={label}
        value={world.settings[k]}
        options={options}
        onChange={(v) => saveSettings({ [k]: v })}
      />
    </Row>
  );
}

export function SelectBox({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 max-w-full min-w-40 rounded-lg border border-white/[0.06] bg-surface-2 px-2 text-sm outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-brand"
    >
      {options.map(([id, text]) => (
        <option key={id} value={id}>
          {text}
        </option>
      ))}
    </select>
  );
}

export function SliderRow({
  k,
  label,
  hint,
  min = 0,
  max = 200,
}: {
  k: KeyOf<number>;
  label: string;
  hint: string;
  min?: number;
  max?: number;
}) {
  return (
    <Row label={label} hint={hint} k={k}>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={world.settings[k]}
        onChange={(e) => saveSettings({ [k]: Number(e.target.value) })}
        className="w-40 accent-brand"
      />
      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
        {world.settings[k]}%
      </span>
    </Row>
  );
}
