import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "./cn";

const sizes = { sm: "size-7", md: "size-9" } as const;

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  icon: ReactNode;
  size?: keyof typeof sizes;
  active?: boolean;
  tone?: "default" | "danger";
  ref?: Ref<HTMLButtonElement>;
};

export function IconButton({
  label,
  icon,
  size = "md",
  active = false,
  tone = "default",
  type = "button",
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      {...props}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-50",
        tone === "danger" ? "hover:text-danger" : "hover:text-fg",
        active && "bg-surface-3 text-fg",
        sizes[size],
        className,
      )}
    >
      {icon}
    </button>
  );
}
