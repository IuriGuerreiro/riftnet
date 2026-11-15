// INVARIANT: only tagged comments may exist; see tools/lint/check-rust-comments.mjs for the Rust twin.
const TAG = /^\s*\*?\s*(INVARIANT|SAFETY|WARN):/;
const DIRECTIVE = /^\s*(eslint|global\s|@ts-|\/\s*<reference)/;
const MAX_PER_FILE = 2;

const onlyTagged = {
  meta: {
    type: "suggestion",
    fixable: "code",
    messages: {
      untagged: "No comments. If this is critical, start it with INVARIANT:, SAFETY: or WARN:.",
      tooMany: `At most ${MAX_PER_FILE} tagged comments per file.`,
    },
    schema: [],
  },
  create(context) {
    const sc = context.sourceCode;
    return {
      Program() {
        let tagged = 0;
        for (const c of sc.getAllComments()) {
          if (c.type === "Shebang" || DIRECTIVE.test(c.value)) continue;
          if (TAG.test(c.value)) {
            tagged += 1;
            if (tagged > MAX_PER_FILE) context.report({ loc: c.loc, messageId: "tooMany" });
            continue;
          }
          context.report({
            loc: c.loc,
            messageId: "untagged",
            fix(fixer) {
              const [start, end] = c.range;
              const text = sc.text;
              const lineStart = text.lastIndexOf("\n", start - 1) + 1;
              let lineEnd = text.indexOf("\n", end);
              if (lineEnd === -1) lineEnd = text.length;
              const before = text.slice(lineStart, start);
              const after = text.slice(end, lineEnd);
              if (before.trim() === "" && after.trim() === "") {
                return fixer.removeRange([lineStart, Math.min(lineEnd + 1, text.length)]);
              }
              let s = start;
              while (s > lineStart && /[ \t]/.test(text.charAt(s - 1))) s -= 1;
              return fixer.removeRange([s, end]);
            },
          });
        }
      },
    };
  },
};

export default { rules: { "only-tagged": onlyTagged } };
