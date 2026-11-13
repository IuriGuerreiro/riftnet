// Tiny shared UI pieces. José will replace these with the real design system.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";

export function Card({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-sm space-y-4 rounded-xl bg-zinc-900 p-6 shadow-lg">{children}</div>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { error?: string }>(
  ({ error, ...props }, ref) => (
    <div className="space-y-1">
      <input
        ref={ref}
        {...props}
        className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-zinc-100 outline-none ring-brand focus:ring-2"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  ),
);

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="w-full rounded-lg bg-brand px-4 py-2 font-semibold text-zinc-950 transition hover:brightness-110 active:scale-95 disabled:opacity-50"
    />
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-400">{error instanceof Error ? error.message : String(error)}</p>;
}
