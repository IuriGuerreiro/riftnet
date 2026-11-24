import { ArrowUp, CornerUpLeft, Plus, Smile, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchEmoji, useEmojiIndex } from "@/features/emoji/data";
import { Emoji } from "@/features/emoji/Emoji";
import { EmojiPicker } from "@/features/emoji/EmojiPicker";
import { EmojiText } from "@/features/emoji/EmojiText";
import { GifPicker } from "@/features/media/GifPicker";
import { type Staged, StagedTray } from "@/features/media/StagedTray";
import { cn } from "@/lib/utils";
import { type Attachment, ME, type Message, user } from "@/mock/data";

import { getDraft, saveDraft } from "./drafts";

const PARTIAL = /(^|\s):([a-z0-9_+-]{2,})$/i;
const COMPLETE = /(?<!\S):([a-z0-9_+-]+):$/i;
const MENTION = /(^|\s)@([\w.]*)$/;

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

interface Suggestion {
  key: string;
  insert: string;
  label: ReactNode;
  hint?: ReactNode;
}

function mentionSuggestions(query: string, members: string[], isChannel: boolean): Suggestion[] {
  const q = query.toLowerCase();
  const people: Suggestion[] = members
    .filter((id) => id !== ME)
    .map(user)
    .filter((u) => !q || u.name.toLowerCase().startsWith(q) || u.handle.startsWith(q))
    .slice(0, 8)
    .map((u) => ({
      key: u.id,
      insert: `@${u.handle}`,
      label: (
        <span className="flex items-center gap-2.5">
          <Avatar id={u.id} size={22} status ringBg="var(--popover)" />
          <span className="font-medium">{u.name}</span>
        </span>
      ),
      hint: `@${u.handle}`,
    }));
  const groups: Suggestion[] = isChannel
    ? [
        {
          key: "everyone",
          insert: "@everyone",
          label: <b>@everyone</b>,
          hint: "Notify everyone in this channel",
        },
        { key: "here", insert: "@here", label: <b>@here</b>, hint: "Notify everyone online" },
      ].filter((g) => g.key.startsWith(q))
    : [];
  return [...people, ...groups];
}

export function Composer({
  draftKey,
  placeholder,
  typing,
  onSend,
  staged,
  onAddFiles,
  onRemoveStaged,
  onSendGif,
  replyTo,
  onCancelReply,
  onEditLast,
  members,
  isChannel,
}: {
  draftKey: string;
  placeholder: string;
  typing?: string;
  onSend: (text: string) => void;
  staged: Staged[];
  onAddFiles: (files: File[]) => void;
  onRemoveStaged: (id: string) => void;
  onSendGif: (gif: Extract<Attachment, { kind: "gif" }>) => void;
  replyTo?: Message;
  onCancelReply: () => void;
  onEditLast: () => void;
  members: string[];
  isChannel: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const index = useEmojiIndex();
  const [storedText, setStoredText] = useState(() => getDraft(draftKey).text);
  const [caret, setCaret] = useState(() => getDraft(draftKey).text.length);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const text = storedText;
  const setText = (value: string) => {
    setStoredText(value);
    saveDraft(draftKey, { text: value });
  };

  useEffect(() => {
    if (replyTo) area.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text]);

  const before = text.slice(0, caret);
  const emojiQuery = PARTIAL.exec(before)?.[2] ?? null;
  const mentionQuery = MENTION.exec(before)?.[2] ?? null;
  const query = emojiQuery ?? mentionQuery;
  const trigger = emojiQuery !== null ? ":" : "@";
  const suggestions = useMemo<Suggestion[]>(() => {
    if (query === null || `${trigger}${query}` === dismissed) return [];
    if (trigger === "@") return mentionSuggestions(query, members, isChannel);
    if (!index) return [];
    return searchEmoji(index, query, 8).map((e) => ({
      key: e.hexcode,
      insert: e.unicode,
      label: (
        <span className="flex items-center gap-3">
          <Emoji emoji={e.unicode} size={22} />
          <span className="font-mono text-[13px]">:{e.shortcodes[0] ?? e.label}:</span>
        </span>
      ),
      hint: <span className="capitalize">{e.label}</span>,
    }));
  }, [index, query, trigger, dismissed, members, isChannel]);
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

  const accept = (sug: Suggestion) => {
    if (query === null) return;
    replaceBeforeCaret(caret - query.length - 1, `${sug.insert} `);
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
    setDismissed(null);
    setHighlight(0);
  };

  const canSend = text.trim().length > 0 || staged.length > 0;
  const send = () => {
    const t = text.trim();
    if (!canSend) return;
    onSend(t);
    setText("");
    setDismissed(null);
    setCaret(0);
  };

  return (
    <div className="relative px-4 pb-4">
      {suggestions.length > 0 && (
        <div className="animate-in fade-in slide-in-from-bottom-1 absolute right-4 bottom-full left-4 z-30 mb-2 overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-2xl shadow-black/40 duration-150">
          <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {trigger === ":" ? "Emoji matching" : "Members matching"}{" "}
            <span className="text-foreground normal-case">
              {trigger}
              {query}
            </span>
          </p>
          {suggestions.map((sug, i) => (
            <button
              key={sug.key}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(ev) => {
                ev.preventDefault();
                accept(sug);
              }}
              className={cn(
                "flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm",
                i === selected ? "bg-accent text-foreground" : "text-foreground/80",
              )}
            >
              {sug.label}
              <span className="ml-auto truncate text-xs text-muted-foreground">{sug.hint}</span>
            </button>
          ))}
        </div>
      )}

      <TypingLine name={typing} />
      <div className="overflow-hidden rounded-xl border border-border bg-surface-2 transition-colors focus-within:border-brand/50">
        {replyTo && (
          <div className="animate-in fade-in slide-in-from-bottom-1 flex items-center gap-2 border-b border-border bg-surface-1 px-3 py-2 text-xs duration-150">
            <CornerUpLeft className="size-3.5 shrink-0 -scale-x-100 text-brand" />
            <span className="shrink-0 text-muted-foreground">
              Replying to{" "}
              <b className="font-semibold text-foreground">{user(replyTo.author).name}</b>
            </span>
            <span className="min-w-0 truncate text-muted-foreground/80">
              {replyTo.text ? <EmojiText text={replyTo.text} size={14} /> : <i>Attachment</i>}
            </span>
            <button
              type="button"
              aria-label="Cancel reply"
              onClick={onCancelReply}
              className="ml-auto grid size-5 shrink-0 place-items-center rounded-full bg-surface-3 text-muted-foreground hover:bg-surface-4 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
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
              if (e.nativeEvent.isComposing) return;
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
                  if (pick) accept(pick);
                  return;
                }
                if (e.key === "Escape") {
                  setDismissed(`${trigger}${query ?? ""}`);
                  return;
                }
              }
              if (e.key === "Escape" && replyTo) {
                onCancelReply();
                return;
              }
              if (e.key === "ArrowUp" && text === "") {
                e.preventDefault();
                onEditLast();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            className="min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-muted-foreground/70"
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
