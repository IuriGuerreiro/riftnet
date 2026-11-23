import { Search } from "lucide-react";
import { useState } from "react";

import { type Attachment, GIFS } from "@/mock/data";

type Gif = Extract<Attachment, { kind: "gif" }>;

export function GifPicker({ onPick }: { onPick: (gif: Gif) => void }) {
  const [q, setQ] = useState("");
  const list = GIFS.filter((g) => g.name.includes(q.toLowerCase().trim()));
  return (
    <div className="flex h-[420px] w-[380px] flex-col">
      <div className="p-2.5">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-surface-3/60 px-3 text-sm focus-within:ring-2 focus-within:ring-brand/40">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search GIFs"
            className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {q ? `Results for “${q}”` : "Trending"}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5">
        {list.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No GIFs found</p>
        ) : (
          <div className="columns-2 gap-1.5">
            {list.map((g) => (
              <button
                key={g.url}
                type="button"
                onClick={() => onPick(g)}
                className="group/gif relative mb-1.5 block w-full overflow-hidden rounded-lg bg-surface-2"
                style={{ aspectRatio: `${g.w} / ${g.h}` }}
              >
                <img
                  src={g.url}
                  alt={g.name}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-300 group-hover/gif:scale-105"
                />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1 text-left text-xs font-medium text-white opacity-0 transition-opacity group-hover/gif:opacity-100">
                  {g.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Mock GIFs. Real search needs a GIF provider (Tenor, GIPHY or KLIPY).
      </p>
    </div>
  );
}
