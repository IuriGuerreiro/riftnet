import { useEffect, useRef, useState } from "react";

import { useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { QUICK_EMOJIS } from "../../stores/reactions";

export function ReactionPicker({ messageId }: { messageId: bigint }) {
  const ws = useConnection((s) => s.ws);
  const toggle = useChat((s) => s.toggleReaction);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!ws) return null;

  return (
    <div ref={ref} className="relative">
      <button
        aria-label="Add reaction"
        title="Add reaction"
        onClick={() => setOpen((o) => !o)}
        className={`${open ? "flex" : "hidden group-hover:flex"} rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100`}
      >
        ☺+
      </button>
      {open && (
        <div className="absolute bottom-full z-10 mb-1 flex gap-0.5 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-lg">
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => {
                setOpen(false);
                void toggle(ws, messageId, e);
              }}
              className="rounded px-1 text-lg hover:bg-zinc-800"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
