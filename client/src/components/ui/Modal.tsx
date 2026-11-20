import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { IconButton } from "./IconButton";

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-panel bg-surface-2 p-0 text-fg shadow-pop backdrop:bg-black/60"
    >
      {open && (
        <div className="flex flex-col">
          <header className="flex items-center justify-between px-5 pt-5">
            <h2 className="text-lg font-bold">{title}</h2>
            <IconButton label="Close" size="sm" icon={<X size={18} />} onClick={onClose} />
          </header>
          <div className="space-y-4 px-5 py-4">{children}</div>
          {footer !== undefined && (
            <footer className="flex justify-end gap-2 rounded-b-panel bg-surface-1 px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
