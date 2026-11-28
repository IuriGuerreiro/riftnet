import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TAG = /^(?:\/\/[/!]?|\/\*[*!]?)\s*(?:INVARIANT|SAFETY|WARN):/;
const MAX_PER_FILE = 2;

function comments(src) {
  const found = [];
  let i = 0;
  let line = 1;
  const advance = (to) => {
    for (; i < to; i++) if (src[i] === "\n") line++;
  };
  while (i < src.length) {
    const rest = src.slice(i, i + 3);
    if (rest.startsWith("//")) {
      let j = src.indexOf("\n", i);
      if (j === -1) j = src.length;
      found.push({ line, text: src.slice(i, j) });
      advance(j);
      continue;
    }
    if (rest.startsWith("/*")) {
      let depth = 0;
      let j = i;
      while (j < src.length) {
        if (src.startsWith("/*", j)) {
          depth++;
          j += 2;
        } else if (src.startsWith("*/", j)) {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else j++;
      }
      found.push({ line, text: src.slice(i, j) });
      advance(j);
      continue;
    }
    const prev = i > 0 ? src.charAt(i - 1) : "";
    const raw = /^b?r(#*)"/.exec(src.slice(i, i + 40));
    if (raw && !/\w/.test(prev)) {
      const end = `"${raw[1]}`;
      advance(src.indexOf(end, i + raw[0].length) + end.length);
      continue;
    }
    if (src[i] === '"' || (src.startsWith('b"', i) && !/\w/.test(prev))) {
      let j = i + (src[i] === "b" ? 2 : 1);
      while (src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      advance(j + 1);
      continue;
    }
    if (src[i] === "'") {
      const ch = /^'(\\.[^']*|[^\\'])'/.exec(src.slice(i, i + 12));
      if (ch) {
        advance(i + ch[0].length);
        continue;
      }
    }
    advance(i + 1);
  }
  return found;
}

const files = execFileSync("git", ["ls-files", "*.rs"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

let errors = 0;
for (const file of files) {
  let tagged = 0;
  for (const c of comments(readFileSync(file, "utf8"))) {
    if (!TAG.test(c.text)) {
      console.error(
        `${file}:${c.line}: no comments; tag critical ones INVARIANT:, SAFETY: or WARN:`,
      );
      errors++;
    } else if (++tagged > MAX_PER_FILE) {
      console.error(`${file}:${c.line}: at most ${MAX_PER_FILE} tagged comments per file`);
      errors++;
    }
  }
}
if (errors > 0) {
  console.error(`\n${errors} comment problem(s).`);
  process.exit(1);
}
console.log(`Rust comments OK (${files.length} files).`);
