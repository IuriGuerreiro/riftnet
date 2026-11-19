import type { ReactNode } from "react";

export function MessageBubble({
  mine,
  children,
  pending = false,
  failed = false,
  title,
}: {
  mine: boolean;
  children: ReactNode;
  pending?: boolean;
  failed?: boolean;
  title?: string;
}) {
  return (
    <p
      className={`max-w-[75%] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-sm ${
        mine ? "bg-brand text-zinc-950" : "bg-zinc-800"
      } ${pending ? "opacity-50" : ""} ${failed ? "ring-2 ring-red-500" : ""}`}
      title={title}
    >
      {children}
    </p>
  );
}
