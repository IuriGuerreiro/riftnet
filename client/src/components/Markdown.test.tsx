import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { highlight } from "../lib/markdown/highlight";
import { Markdown } from "./Markdown";

const render = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown messages", () => {
  it("renders inline formatting and escapes", () => {
    const html = render("**bold and *italic*** ~~strike~~ \\*literal\\* `**code**`");
    expect(html).toContain("<strong>bold and <em>italic</em></strong>");
    expect(html).toContain("<del>strike</del>");
    expect(html).toContain("*literal*");
    expect(html).toContain(">**code**</code>");
  });

  it("renders quotes, ordered and unordered lists, and fenced code", () => {
    const html = render("> **quote**\n\n3. first\n4. second\n\n- item\n\n```js\n<b>\n```");
    expect(html).toMatch(/<blockquote[^>]*><p><strong>quote<\/strong>/);
    expect(html).toMatch(/<ol[^>]*start="3"[^>]*><li>first<\/li><li>second<\/li><\/ol>/);
    expect(html).toMatch(/<ul[^>]*><li>item<\/li><\/ul>/);
    expect(html).toContain("<code>&lt;b&gt;</code>");
    expect(html).toContain(">Copy</button>");
  });

  it("hides spoilers behind an accessible button", () => {
    const html = render("||secret https://example.com||");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">Show spoiler</button>");
    expect(html).not.toContain("secret");
    expect(html).not.toContain("<a ");
  });

  it("links only HTTP(S) and leaves surrounding punctuation alone", () => {
    const html = render(
      "(https://example.com/a_(b)). <http://example.net> [site](https://example.org)",
    );
    expect(html).toContain('href="https://example.com/a_(b)"');
    expect(html).toContain("</a>).");
    expect(html).toContain('href="http://example.net/"');
    expect(html).toContain('href="https://example.org/"');
    expect(html.match(/target="_blank" rel="noreferrer noopener"/g)).toHaveLength(3);
  });

  it.each([
    "[click](javascript:alert(1))",
    "[click](JaVaScRiPt:alert(1))",
    "[click](java&#x73;cript:alert(1))",
    "[click](java%73cript:alert(1))",
    "[click](java\tscript:alert(1))",
    "[click](data:text/html,<script>)",
    "[click](//example.com)",
    '![image](https://example.com/image.png "title")',
    '<img src="https://example.com/image.png" onerror="alert(1)">',
    '<img alt=">" src="https://example.com/image.png">',
    "<script>alert(1)</script>",
  ])("renders unsafe markup as text (%s)", (text) => {
    const html = render(text);
    expect(html).not.toMatch(/<(?:a |img|script)/i);
    expect(html).toContain(renderToStaticMarkup(<p>{text}</p>));
  });

  it("keeps quotes and attribute-like text inside the URL or text content", () => {
    const html = render('[click](https://example.com/"onmouseover="alert(1))');
    expect(html).toContain('href="https://example.com/%22onmouseover=%22alert(1)"');
    expect(html).not.toContain(" onmouseover=");
  });

  it("renders highlighted tokens as escaped React text", () => {
    const html = renderToStaticMarkup(<code>{highlight("js", 'const x = "<img>";')}</code>);
    expect(html).toContain('class="hljs-keyword">const');
    expect(html).toContain("&lt;img&gt;");
    expect(html).not.toContain("<img>");
    expect(highlight("unknown-language", "<img>")).toBe("<img>");
  });
});
