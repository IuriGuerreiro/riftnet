import { type InputHTMLAttributes, type Ref, type TextareaHTMLAttributes, useId } from "react";

import { cn } from "./cn";

export const fieldClass =
  "w-full min-w-0 rounded-control border border-transparent bg-surface-0 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none transition-colors focus:border-brand disabled:opacity-50";

interface FieldExtras {
  label?: string;
  error?: string;
  hint?: string;
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: FieldExtras & { id: string; children: React.ReactNode }) {
  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-xs font-semibold uppercase text-fg-muted">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-msg`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-msg`} className="text-xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  label,
  error,
  hint,
  id,
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & FieldExtras & { ref?: Ref<HTMLInputElement> }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field id={fid} label={label} error={error} hint={hint}>
      <input
        id={fid}
        ref={ref}
        aria-invalid={!!error || undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        {...props}
        className={cn(fieldClass, error && "border-danger", className)}
      />
    </Field>
  );
}

export function Textarea({
  label,
  error,
  hint,
  id,
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldExtras & { ref?: Ref<HTMLTextAreaElement> }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field id={fid} label={label} error={error} hint={hint}>
      <textarea
        id={fid}
        ref={ref}
        aria-invalid={!!error || undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        {...props}
        className={cn(fieldClass, "resize-none", error && "border-danger", className)}
      />
    </Field>
  );
}
