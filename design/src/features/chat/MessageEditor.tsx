import { useEffect, useRef, useState } from "react";

export function MessageEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  return (
    <div className="my-1">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave(text.trim());
          }
        }}
        className="max-h-64 w-full resize-none rounded-lg border border-brand/50 bg-surface-2 px-3 py-2 text-[15px] leading-relaxed outline-none focus:ring-2 focus:ring-brand/30"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Esc to{" "}
        <button type="button" onClick={onCancel} className="text-brand-text hover:underline">
          cancel
        </button>{" "}
        · Enter to{" "}
        <button
          type="button"
          onClick={() => onSave(text.trim())}
          className="text-brand-text hover:underline"
        >
          save
        </button>
      </p>
    </div>
  );
}
