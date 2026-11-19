import type { ButtonHTMLAttributes, Ref } from "react";

import { cn } from "./cn";

const variants = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover",
  secondary: "bg-surface-3 text-fg hover:bg-surface-4",
  ghost: "text-fg-muted hover:bg-surface-3 hover:text-fg",
  danger: "bg-danger text-white hover:brightness-110",
} as const;

const sizes = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
  lg: "h-11 px-5 text-base",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      {...props}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-semibold transition-colors active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        block && "w-full",
        className,
      )}
    />
  );
}
