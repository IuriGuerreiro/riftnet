import { Play } from "lucide-react";
import { useState } from "react";

import { VideoPlayer } from "@/features/media/VideoPlayer";
import { type Block, type Inline, parseMarkdown } from "@/lib/markdown/parse";
import { type Embed as EmbedData, embedFor } from "@/mock/embeds";

export function embedsIn(text: string): EmbedData[] {
  const urls = new Set<string>();
  const inline = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (typeof node === "string") continue;
      if (node.kind === "link" && !node.suppressEmbed) urls.add(node.href);
      else if ("children" in node && node.kind !== "spoiler") inline(node.children);
    }
  };
  const blocks = (nodes: Block[]) => {
    for (const node of nodes) {
      if (node.kind === "paragraph") inline(node.children);
      else if (node.kind === "quote") blocks(node.children);
      else if (node.kind === "list") {
        for (const item of node.items) inline(item);
      }
    }
  };
  blocks(parseMarkdown(text));
  return Array.from(urls)
    .map(embedFor)
    .filter((e): e is EmbedData => e !== undefined);
}

function VideoEmbed({ e }: { e: Extract<EmbedData, { kind: "video" }> }) {
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <p className="text-xs text-muted-foreground">{e.author}</p>
      <a
        href={e.url}
        target="_blank"
        rel="noreferrer"
        className="block font-semibold text-sky-400 hover:underline"
      >
        {e.title}
      </a>
      <div className="mt-2">
        {playing ? (
          <VideoPlayer url={e.video} name={e.title} size={0} w={16} h={9} autoPlay />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play ${e.title}`}
            className="group/yt relative block aspect-video w-full max-w-[400px] overflow-hidden rounded-lg"
          >
            <img src={e.thumb} alt="" className="size-full object-cover" />
            <span className="absolute inset-0 grid place-items-center bg-black/25 transition-colors group-hover/yt:bg-black/10">
              <span className="grid h-11 w-16 place-items-center rounded-xl bg-[#ff0033] shadow-lg transition-transform group-hover/yt:scale-110">
                <Play className="size-5 fill-white text-white" />
              </span>
            </span>
          </button>
        )}
      </div>
    </>
  );
}

export function Embed({ e }: { e: EmbedData }) {
  return (
    <div
      className="mt-2 w-full max-w-[440px] rounded-md border border-border border-l-4 bg-surface-1 p-3"
      style={{ borderLeftColor: e.color }}
    >
      <p className="mb-1 text-xs font-medium text-muted-foreground">{e.site}</p>
      {e.kind === "video" ? (
        <VideoEmbed e={e} />
      ) : (
        <div className={e.large ? "" : "flex gap-3"}>
          <div className="min-w-0 flex-1">
            <a
              href={e.url}
              target="_blank"
              rel="noreferrer"
              className="block font-semibold text-sky-400 hover:underline"
            >
              {e.title}
            </a>
            <p className="mt-1 text-sm text-foreground/80">{e.description}</p>
          </div>
          {e.image &&
            (e.large ? (
              <img
                src={e.image}
                alt=""
                className="mt-3 aspect-video w-full rounded-lg object-cover"
              />
            ) : (
              <img
                src={e.image}
                alt=""
                className="size-16 shrink-0 rounded-lg bg-ink object-contain p-1"
              />
            ))}
        </div>
      )}
    </div>
  );
}
