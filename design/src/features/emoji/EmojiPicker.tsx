import {
  Apple,
  Clock,
  Flag,
  Gamepad2,
  Hand,
  Heart,
  Lightbulb,
  Plane,
  Search,
  Smile,
  Sprout,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import {
  type EmojiEntry,
  emojiKey,
  GROUPS,
  pushRecent,
  readRecent,
  searchEmoji,
  useEmojiIndex,
} from "./data";
import { Emoji } from "./Emoji";

const GROUP_ICON: Record<number, typeof Smile> = {
  0: Smile,
  1: Hand,
  3: Sprout,
  4: Apple,
  5: Plane,
  6: Gamepad2,
  7: Lightbulb,
  8: Heart,
  9: Flag,
};

const COLUMNS = 9;

function Cell({
  e,
  onPick,
  onHover,
}: {
  e: EmojiEntry;
  onPick: (e: EmojiEntry) => void;
  onHover: (e: EmojiEntry) => void;
}) {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  return (
    <button
      type="button"
      aria-label={e.label}
      onClick={() => onPick(e)}
      onMouseEnter={() => onHover(e)}
      onFocus={() => onHover(e)}
      className="grid aspect-square place-items-center rounded-lg transition-transform duration-100 hover:scale-110 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none active:scale-95"
    >
      <Emoji emoji={e.unicode} size={28} onUnavailable={() => setMissing(true)} />
    </button>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="[content-visibility:auto] [contain-intrinsic-size:auto_400px]">
      <h4 className="sticky top-0 z-10 bg-popover/95 px-1 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase backdrop-blur">
        {title}
      </h4>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}
      >
        {children}
      </div>
    </section>
  );
}

export function EmojiPicker({ onPick }: { onPick: (unicode: string) => void }) {
  const index = useEmojiIndex();
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<EmojiEntry | null>(null);
  const [activeGroup, setActiveGroup] = useState<number | "recent">("recent");
  const scroller = useRef<HTMLDivElement>(null);

  const recent = useMemo(
    () =>
      index
        ? readRecent()
            .map((u) => index.byKey.get(emojiKey(u)))
            .filter((e): e is EmojiEntry => e !== undefined)
        : [],
    [index],
  );
  const results = useMemo(
    () => (index && query ? searchEmoji(index, query, 90) : []),
    [index, query],
  );
  const byGroup = useMemo(
    () => GROUPS.map((g) => ({ ...g, items: index?.list.filter((e) => e.group === g.id) ?? [] })),
    [index],
  );

  const pick = (e: EmojiEntry) => {
    pushRecent(e.unicode);
    onPick(e.unicode);
  };

  const jump = (id: number | "recent") => {
    setQuery("");
    setActiveGroup(id);
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector(`#emoji-group-${id}`);
      if (el instanceof HTMLElement && scroller.current) {
        scroller.current.scrollTo({ top: el.offsetTop - 4 });
      }
    });
  };

  const onScroll = () => {
    const sc = scroller.current;
    if (!sc || query) return;
    const sections = sc.querySelectorAll<HTMLElement>("section[id^=emoji-group-]");
    let current: number | "recent" = "recent";
    for (const s of sections) {
      if (s.offsetTop - sc.scrollTop <= 24) {
        const id = s.id.replace("emoji-group-", "");
        current = id === "recent" ? "recent" : Number(id);
      }
    }
    setActiveGroup(current);
  };

  const shown = hover ?? recent[0];

  return (
    <div className="flex h-[420px] w-[360px] flex-col overflow-hidden rounded-xl">
      <div className="p-2.5 pb-2">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-surface-3/60 px-3 text-sm focus-within:ring-2 focus-within:ring-brand/40">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emoji"
            className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div className="flex items-center gap-0.5 border-b border-border px-2 pb-1.5">
        {[
          { id: "recent" as const, Icon: Clock, label: "Recent" },
          ...GROUPS.map((g) => ({ id: g.id, Icon: GROUP_ICON[g.id] ?? Smile, label: g.label })),
        ].map(({ id, Icon, label }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            onClick={() => jump(id)}
            className={cn(
              "grid size-8 flex-1 place-items-center rounded-md transition-colors",
              activeGroup === id && !query
                ? "bg-brand/15 text-brand"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        {!index ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            Loading emoji…
          </div>
        ) : query ? (
          results.length > 0 ? (
            <Section id="emoji-results" title={`Results for “${query}”`}>
              {results.map((e) => (
                <Cell key={e.hexcode} e={e} onPick={pick} onHover={setHover} />
              ))}
            </Section>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Emoji emoji="🔍" size={40} />
              <p className="text-sm text-muted-foreground">No emoji match “{query}”</p>
            </div>
          )
        ) : (
          <>
            <Section id="emoji-group-recent" title="Frequently used">
              {recent.map((e) => (
                <Cell key={e.hexcode} e={e} onPick={pick} onHover={setHover} />
              ))}
            </Section>
            {byGroup.map((g) => (
              <Section key={g.id} id={`emoji-group-${g.id}`} title={g.label}>
                {g.items.map((e) => (
                  <Cell key={e.hexcode} e={e} onPick={pick} onHover={setHover} />
                ))}
              </Section>
            ))}
          </>
        )}
      </div>

      <div className="flex h-14 shrink-0 items-center gap-3 border-t border-border bg-surface-1/60 px-3">
        {shown && (
          <>
            <Emoji emoji={shown.unicode} size={32} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium capitalize">{shown.label}</p>
              {shown.shortcodes[0] && (
                <p className="truncate font-mono text-xs text-muted-foreground">
                  :{shown.shortcodes[0]}:
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
