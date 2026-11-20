import { useState } from "react";

export function MessageEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <div className="space-y-1 py-1">
      <textarea
        autoFocus
        value={draft}
        maxLength={4000}
        rows={Math.min(8, draft.split("\n").length)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave(draft);
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        className="w-full resize-none rounded-control bg-surface-3 px-3 py-2 text-sm text-fg outline-none"
      />
      <p className="text-xs text-fg-subtle">
        Escape to{" "}
        <button type="button" onClick={onCancel} className="text-brand hover:underline">
          cancel
        </button>{" "}
        · Enter to{" "}
        <button type="button" onClick={() => onSave(draft)} className="text-brand hover:underline">
          save
        </button>
      </p>
    </div>
  );
}
