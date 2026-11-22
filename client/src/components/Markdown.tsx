/* eslint-disable react-x/no-array-index-key -- The rendered tree remounts whenever the message text changes. */
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { type Block, type Inline, parseMarkdown } from "../lib/markdown/parse";

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className="rounded bg-surface-0 px-1 text-white">
      <button
        type="button"
        className="cursor-pointer text-xs underline"
        aria-expanded={revealed}
        onClick={() => setRevealed(!revealed)}
      >
        {revealed ? "Hide spoiler" : "Show spoiler"}
      </button>
      {revealed && <> {children}</>}
    </span>
  );
}

function CodeBlock({ language, text }: { language: string; text: string }) {
  const [highlighted, setHighlighted] = useState<ReactNode>(text);
  const [copyStatus, setCopyStatus] = useState("Copy");

  useEffect(() => {
    if (!language || !text) return;
    let active = true;
    void import("../lib/markdown/highlight")
      .then(({ highlight }) => {
        if (active) setHighlighted(highlight(language, text));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [language, text]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  return (
    <div className="my-1 min-w-0 rounded bg-surface-0 text-fg">
      <div className="flex items-center justify-between gap-2 border-b border-line-strong px-2 py-1 text-xs">
        <span>{language || "Code"}</span>
        <button type="button" onClick={copy} className="cursor-pointer underline">
          {copyStatus}
        </button>
      </div>
      <pre className="message-code overflow-x-auto whitespace-pre p-2">
        <code>{highlighted}</code>
      </pre>
    </div>
  );
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, index) => {
    if (typeof node === "string") return node;
    switch (node.kind) {
      case "code":
        return (
          <code key={index} className="rounded bg-surface-0 px-1 text-fg">
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline"
          >
            {node.text}
          </a>
        );
      case "spoiler":
        return <Spoiler key={index}>{renderInline(node.children)}</Spoiler>;
      case "strong":
      case "em":
      case "del": {
        const Tag = node.kind;
        return <Tag key={index}>{renderInline(node.children)}</Tag>;
      }
    }
  });
}

function renderBlocks(blocks: Block[]): ReactNode {
  return blocks.map((block, index) => {
    switch (block.kind) {
      case "paragraph":
        return <p key={index}>{renderInline(block.children)}</p>;
      case "code":
        return <CodeBlock key={index} language={block.language} text={block.text} />;
      case "quote":
        return (
          <blockquote key={index} className="my-1 border-l-2 border-current pl-2">
            {renderBlocks(block.children)}
          </blockquote>
        );
      case "list": {
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInline(item)}</li>
        ));
        return block.start === null ? (
          <ul key={index} className="list-disc pl-5">
            {items}
          </ul>
        ) : (
          <ol key={index} start={block.start} className="list-decimal pl-5">
            {items}
          </ol>
        );
      }
    }
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div key={text}>{renderBlocks(blocks)}</div>;
}
