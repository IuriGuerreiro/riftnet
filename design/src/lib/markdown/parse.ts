type Format = "strong" | "em" | "del" | "spoiler";

export type Inline =
  | string
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; text: string }
  | { kind: Format; children: Inline[] };

export type Block =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "quote"; children: Block[] }
  | { kind: "code"; language: string; text: string }
  | { kind: "list"; start: number | null; items: Inline[][] };

const formats = new Map<string, Format>([
  ["**", "strong"],
  ["__", "strong"],
  ["*", "em"],
  ["_", "em"],
  ["~~", "del"],
  ["||", "spoiler"],
]);

const maxDepth = 12;
const maxMessageLength = 8 * 1024;

function safeHref(destination: string): string | undefined {
  if (!/^https?:\/\//i.test(destination) || /\s/.test(destination)) return;
  try {
    const url = new URL(destination);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return;
  }
}

function bareUrlText(text: string) {
  const trimmed = text.replace(/[.,!?;:]+$/, "");
  const opens = trimmed.split("(").length;
  const closes = trimmed.split(")").length;
  const trailing = /\)+$/.exec(trimmed)?.[0].length ?? 0;
  return trimmed.slice(0, trimmed.length - Math.min(trailing, Math.max(0, closes - opens)));
}

interface FormatFrame {
  delimiter: string;
  kind: Format;
  children: Inline[];
  depth: number;
  parent: FormatFrame | undefined;
}

function parseInline(text: string): Inline[] {
  const root: Inline[] = [];
  let frame: FormatFrame | undefined;
  const current = () => frame?.children ?? root;
  const tokens =
    /\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])|(?<!`)(`+)(?!`)([^\n]*?)(?<!`)\2(?!`)|(!?)\[([^\]\n]*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)|<https?:\/\/[^\s<>"']+>|<!--[^\n]*?-->|<\/?[a-z](?:[^<>"'\n]|"[^"\n]*"|'[^'\n]*')*>|https?:\/\/[^\s<>"'`*|]+|\*\*\*?|___?|[*_]|~~|\|\|/gi;
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    const [token, escaped, ticks, code, image, label, destination] = match;
    const index = match.index;
    if (index > end) current().push(text.slice(end, index));
    end = index + token.length;

    if (escaped !== undefined) {
      current().push(escaped);
    } else if (ticks && code !== undefined) {
      current().push({ kind: "code", text: code });
    } else if (destination !== undefined && label !== undefined) {
      const href = image ? undefined : safeHref(destination);
      current().push(href ? { kind: "link", href, text: label } : token);
    } else if (/^<?https?:\/\//i.test(token)) {
      const label = token.startsWith("<") ? token.slice(1, -1) : bareUrlText(token);
      const href = safeHref(label);
      current().push(href ? { kind: "link", href, text: label } : token);
      if (!token.startsWith("<") && href && label.length < token.length) {
        current().push(token.slice(label.length));
      }
    } else {
      let delimiter = token;
      let offset = index;
      while (delimiter) {
        if (
          frame &&
          delimiter.startsWith(frame.delimiter) &&
          offset > 0 &&
          !/\s/.test(text.charAt(offset - 1))
        ) {
          const closed = frame;
          frame = closed.parent;
          current().push({ kind: closed.kind, children: closed.children });
          delimiter = delimiter.slice(closed.delimiter.length);
          offset += closed.delimiter.length;
          continue;
        }
        const marker = /^\*{3}$|^_{3}$/.test(delimiter) ? delimiter.slice(0, 2) : delimiter;
        const kind = formats.get(marker);
        const next = text.charAt(offset + marker.length);
        const depth = (frame?.depth ?? 0) + 1;
        if (!kind || !next || /\s/.test(next) || depth > maxDepth) {
          current().push(delimiter);
          break;
        }
        frame = { delimiter: marker, kind, children: [], depth, parent: frame };
        delimiter = delimiter.slice(marker.length);
        offset += marker.length;
      }
    }
  }
  if (end < text.length) current().push(text.slice(end));
  while (frame) {
    const unmatched = frame;
    frame = unmatched.parent;
    current().push(unmatched.delimiter, ...unmatched.children);
  }
  return root;
}

const fence = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w+#.-]*)[ \t]*$/;
const quote = /^ {0,3}>[ \t]?/;
const listItem = /^ {0,3}(?:([0-9]{1,9})\.|[-*+])[ \t]+(.*)$/;

function parseBlocks(lines: string[], depth: number): Block[] {
  if (depth >= maxDepth) return [{ kind: "paragraph", children: [lines.join("\n")] }];

  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const opening = fence.exec(line);
    const marker = opening?.[1];
    const item = listItem.exec(line);
    if (!line.trim()) {
      blocks.push({ kind: "paragraph", children: ["\n"] });
      index++;
    } else if (opening && marker) {
      const code: string[] = [];
      const closing = new RegExp(`^ {0,3}${marker.charAt(0)}{${marker.length},}[ \t]*$`);
      index++;
      while (index < lines.length && !closing.test(lines[index] ?? "")) {
        code.push(lines[index++] ?? "");
      }
      index++;
      blocks.push({
        kind: "code",
        language: opening[2]?.toLowerCase() ?? "",
        text: code.join("\n"),
      });
    } else if (quote.test(line)) {
      const quoted: string[] = [];
      while (quote.test(lines[index] ?? "")) {
        quoted.push((lines[index++] ?? "").replace(quote, ""));
      }
      blocks.push({ kind: "quote", children: parseBlocks(quoted, depth + 1) });
    } else if (item) {
      const start = item[1] === undefined ? null : Number(item[1]);
      const items: Inline[][] = [];
      for (let next = item; (next[1] === undefined) === (start === null);) {
        items.push(parseInline(next[2] ?? ""));
        index++;
        const following = listItem.exec(lines[index] ?? "");
        if (!following) break;
        next = following;
      }
      blocks.push({ kind: "list", start, items });
    } else {
      const paragraph = [line];
      index++;
      for (let next = lines[index]; next?.trim(); next = lines[++index]) {
        if (fence.test(next) || quote.test(next) || listItem.test(next)) break;
        paragraph.push(next);
      }
      blocks.push({ kind: "paragraph", children: parseInline(paragraph.join("\n")) });
    }
  }
  return blocks;
}

export function parseMarkdown(text: string): Block[] {
  if (!text) return [];
  if (text.length > maxMessageLength) return [{ kind: "paragraph", children: [text] }];
  return parseBlocks(text.split(/\r\n?|\n/), 0);
}
