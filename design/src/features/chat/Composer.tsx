import { ArrowUp, Plus, Smile } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchEmoji, useEmojiIndex } from "@/features/emoji/data";
import { Emoji } from "@/features/emoji/Emoji";
import { EmojiPicker } from "@/features/emoji/EmojiPicker";
import { GifPicker } from "@/features/media/GifPicker";
import { type Staged, StagedTray } from "@/features/media/StagedTray";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/mock/data";

const PARTIAL = /(^|\s):([a-z0-9_+-]{2,})$/i;
const COMPLETE = /:([a-z0-9_+-]+):$/i;

function TypingLine({ name }: { name?: string }) {
  return (
    <p className="flex h-6 items-center px-1 text-xs text-muted-foreground">
      {name && (
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
            <b className="font-semibold text-foreground/85">{name}</b> is typing…
          </span>
        </span>
      )}
    </p>
  );
}

export function Composer({
  placeholder,
  typing,
  onSend,
  staged,
  onAddFiles,
  onRemoveStaged,
  onSendGif,
}: {
  placeholder: string;
  typing?: string;
  onSend: (text: string) => void;
  staged: Staged[];
  onAddFiles: (files: File[]) => void;
  onRemoveStaged: (id: string) => void;
  onSendGif: (gif: Extract<Attachment, { kind: "gif" }>) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const index = useEmojiIndex();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const before = text.slice(0, caret);
  const partial = PARTIAL.exec(before)?.[2] ?? null;
  const suggestions = useMemo(
    () => (index && partial && partial !== dismissed ? searchEmoji(index, partial, 8) : []),
    [index, partial, dismissed],
  );
  const selected = Math.min(highlight, Math.max(suggestions.length - 1, 0));

  const replaceBeforeCaret = (from: number, insert: string) => {
    const next = text.slice(0, from) + insert + text.slice(caret);
    const pos = from + insert.length;
    setText(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  };

  const accept = (unicode: string) => {
    if (partial === null) return;
    replaceBeforeCaret(caret - partial.length - 1, `${unicode} `);
  };

  const insertAtCaret = (unicode: string) => {
    replaceBeforeCaret(caret, unicode);
    setPickerOpen(false);
  };

  const onChange = (value: string, pos: number) => {
    const head = value.slice(0, pos);
    const done = COMPLETE.exec(head);
    const entry = done?.[1] ? index?.byShortcode.get(done[1].toLowerCase()) : undefined;
    if (done && entry) {
      const from = pos - done[0].length;
      const next = value.slice(0, from) + entry.unicode + value.slice(pos);
      const at = from + entry.unicode.length;
      setText(next);
      setCaret(at);
      requestAnimationFrame(() => area.current?.setSelectionRange(at, at));
      return;
    }
    setText(value);
    setCaret(pos);
    setHighlight(0);
  };

  const canSend = text.trim().length > 0 || staged.length > 0;
  const send = () => {
    const t = text.trim();
    if (!canSend) return;
    onSend(t);
    setText("");
    setCaret(0);
  };

  return (
    <div className="relative px-4 pb-4">
      {suggestions.length > 0 && (
        <div className="animate-in fade-in slide-in-from-bottom-1 absolute right-4 bottom-full left-4 mb-2 overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-2xl shadow-black/40 duration-150">
          <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Emoji matching <span className="text-foreground normal-case">:{partial}</span>
          </p>
          {suggestions.map((e, i) => (
            <button
              key={e.hexcode}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(ev) => {
                ev.preventDefault();
                accept(e.unicode);
              }}
              className={cn(
                "flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm",
                i === selected ? "bg-accent text-foreground" : "text-foreground/80",
              )}
            >
              <Emoji emoji={e.unicode} size={22} />
              <span className="font-mono text-[13px]">:{e.shortcodes[0] ?? e.label}:</span>
              <span className="ml-auto truncate text-xs text-muted-foreground capitalize">
                {e.label}
              </span>
            </button>
          ))}
        </div>
      )}

      <TypingLine name={typing} />
      <div className="overflow-hidden rounded-xl border border-border bg-surface-2 transition-colors focus-within:border-brand/50">
        <StagedTray items={staged} onRemove={onRemoveStaged} />
        <div className="flex items-end gap-1 p-1.5">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onAddFiles(files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label="Upload a file"
            title="Upload images, videos, GIFs or files"
            onClick={() => fileInput.current?.click()}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-5" />
          </button>
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                onAddFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (suggestions.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const d = e.key === "ArrowDown" ? 1 : -1;
                  setHighlight((selected + d + suggestions.length) % suggestions.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  const pick = suggestions[selected];
                  if (pick) accept(pick.unicode);
                  return;
                }
                if (e.key === "Escape") {
                  setDismissed(partial);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-muted-foreground/70"
          />
          <Popover open={gifOpen} onOpenChange={setGifOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="GIFs"
                className={cn(
                  "grid h-9 shrink-0 place-items-center rounded-lg px-1.5",
                  gifOpen
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="rounded border-[1.5px] border-current px-1 text-[10px] leading-4 font-bold">
                  GIF
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" sideOffset={10} className="w-auto p-0">
              <GifPicker
                onPick={(g) => {
                  onSendGif(g);
                  setGifOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Emoji"
                className={cn(
                  "group grid size-9 shrink-0 place-items-center rounded-lg transition-colors",
                  pickerOpen
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Smile className="size-5 transition-transform group-hover:scale-110" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" sideOffset={10} className="w-auto p-0">
              <EmojiPicker onPick={insertAtCaret} />
            </PopoverContent>
          </Popover>
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg transition-all",
              canSend
                ? "bg-brand text-white hover:bg-brand-hover"
                : "pointer-events-none bg-surface-3 text-muted-foreground/50",
            )}
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
