import { ArrowUp, Plus, Smile } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export function Composer({
  placeholder,
  typing,
  onSend,
}: {
  placeholder: string;
  typing?: string;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="px-4 pb-4">
      <div className="flex items-end gap-1 rounded-xl border border-border bg-surface-2 p-1.5 transition-colors focus-within:border-brand/50">
        <button
          type="button"
          aria-label="Attach"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-5" />
        </button>
        <textarea
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="button"
          aria-label="Emoji"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Smile className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Send"
          onClick={send}
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg transition-all",
            text.trim()
              ? "bg-brand text-white hover:bg-brand-hover"
              : "pointer-events-none bg-surface-3 text-muted-foreground/50",
          )}
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
      <p className="mt-1.5 h-4 px-1 text-[11px] text-muted-foreground">
        {typing && (
          <span className="inline-flex items-center gap-1.5">
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1 animate-bounce rounded-full bg-muted-foreground"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </span>
            <span>
              <b className="font-semibold text-foreground/80">{typing}</b> is typing…
            </span>
          </span>
        )}
      </p>
    </div>
  );
}
