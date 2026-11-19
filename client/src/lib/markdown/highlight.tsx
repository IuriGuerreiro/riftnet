/* eslint-disable react-x/no-array-index-key -- Tokens belong to an immutable code block. */
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { createLowlight } from "lowlight";
import type { ReactNode } from "react";

const highlighter = createLowlight({
  bash,
  css,
  go,
  javascript,
  json,
  python,
  rust,
  sql,
  typescript,
  xml,
});
type HighlightNode = ReturnType<typeof highlighter.highlight>["children"][number];

function renderTokens(nodes: HighlightNode[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.value;
    if (node.type !== "element") return null;
    const classes = node.properties.className;
    return (
      <span key={index} className={Array.isArray(classes) ? classes.join(" ") : undefined}>
        {renderTokens(node.children)}
      </span>
    );
  });
}

export function highlight(language: string, text: string): ReactNode {
  if (!highlighter.registered(language)) return text;
  return renderTokens(highlighter.highlight(language, text).children);
}
