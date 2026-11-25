/* eslint-disable react-x/no-array-index-key -- The tree is rebuilt whenever the message text changes. */
import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { EmojiText } from "@/features/emoji/EmojiText";
import { type Block, type Inline, parseMarkdown } from "@/lib/markdown/parse";
import { cn } from "@/lib/utils";

function Mentions({ text }: { text: string }) {
  return (
    <EmojiText
      text={text}
      renderText={(chunk, key) =>
        chunk.split(/((?<![\w@.])@[\w]+(?:\.[\w]+)*)/g).map((part, i) =>
          part.startsWith("@") ? (
            <span
              key={`${key}-${i}`}
              className="cursor-pointer rounded bg-brand/20 px-0.5 font-medium text-brand-text hover:bg-brand/30"
            >
              {part}
            </span>
          ) : (
            part
          ),
        )
      }
    />
  );
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={shown ? undefined : "Spoiler, click to reveal"}
      onClick={() => setShown(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setShown(true);
        }
      }}
      className={cn(
        "rounded px-0.5 transition-colors duration-200",
        shown
          ? "bg-white/10"
          : "cursor-pointer bg-surface-4 text-transparent select-none hover:bg-surface-4/80 [&_img]:opacity-0",
      )}
    >
      <span inert={!shown} className={shown ? undefined : "pointer-events-none opacity-0"}>
        {children}
      </span>
    </span>
  );
}

function CodeBlock({ language, text }: { language: string; text: string }) {
  const [html, setHtml] = useState<ReactNode>(text);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!language || !text) return;
    let live = true;
    void import("@/lib/markdown/highlight").then(({ highlight }) => {
      if (live) setHtml(highlight(language, text));
    });
    return () => {
      live = false;
    };
  }, [language, text]);

  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="group/code my-1.5 max-w-[680px] overflow-hidden rounded-lg border border-border bg-ink">
      <div className="flex h-8 items-center justify-between border-b border-border bg-surface-1 px-3 text-xs">
        <span className="font-mono text-muted-foreground">{language || "text"}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="message-code overflow-x-auto p-3 font-mono text-[13px] leading-relaxed whitespace-pre">
        <code>{html}</code>
      </pre>
    </div>
  );
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    if (typeof node === "string") return <Mentions key={i} text={node} />;
    switch (node.kind) {
      case "code":
        return (
          <code
            key={i}
            className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
          >
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sky-400 hover:underline"
          >
            {node.text}
          </a>
        );
      case "spoiler":
        return <Spoiler key={i}>{renderInline(node.children)}</Spoiler>;
      case "strong":
        return (
          <strong key={i} className="font-semibold text-foreground">
            {renderInline(node.children)}
          </strong>
        );
      case "em":
        return <em key={i}>{renderInline(node.children)}</em>;
      case "del":
        return (
          <del key={i} className="text-muted-foreground">
            {renderInline(node.children)}
          </del>
        );
    }
  });
}

function renderBlocks(blocks: Block[]): ReactNode {
  return blocks.map((b, i) => {
    switch (b.kind) {
      case "paragraph":
        return <p key={i}>{renderInline(b.children)}</p>;
      case "code":
        return <CodeBlock key={i} language={b.language} text={b.text} />;
      case "quote":
        return (
          <blockquote
            key={i}
            className="my-0.5 border-l-[3px] border-surface-4 pl-3 text-foreground/80"
          >
            {renderBlocks(b.children)}
          </blockquote>
        );
      case "list": {
        const items = b.items.map((item, j) => <li key={j}>{renderInline(item)}</li>);
        return b.start === null ? (
          <ul key={i} className="my-0.5 list-disc pl-5 marker:text-muted-foreground">
            {items}
          </ul>
        ) : (
          <ol
            key={i}
            start={b.start}
            className="my-0.5 list-decimal pl-5 marker:text-muted-foreground"
          >
            {items}
          </ol>
        );
      }
    }
  });
}

export function Markdown({ text, suffix }: { text: string; suffix?: ReactNode }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const last = blocks.at(-1);
  const inlineSuffix = suffix !== undefined && last?.kind === "paragraph";
  return (
    <div className="space-y-0.5 break-words">
      {renderBlocks(inlineSuffix ? blocks.slice(0, -1) : blocks)}
      {inlineSuffix && (
        <p>
          {renderInline(last.children)}
          {suffix}
        </p>
      )}
      {!inlineSuffix && suffix}
    </div>
  );
}
