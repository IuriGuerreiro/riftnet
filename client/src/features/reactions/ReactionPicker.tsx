import { SmilePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "../../components/ui";
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
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!ws) return null;

  return (
    <div ref={ref} className="relative">
      <IconButton
        label="Add reaction"
        size="sm"
        icon={<SmilePlus size={18} />}
        aria-expanded={open}
        active={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 flex gap-0.5 rounded-panel border border-line bg-surface-1 p-1 shadow-pop">
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`React with ${e}`}
              onClick={() => {
                setOpen(false);
                void toggle(ws, messageId, e);
              }}
              className="rounded-md px-1.5 py-0.5 text-xl transition-transform hover:scale-110 hover:bg-surface-3"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
