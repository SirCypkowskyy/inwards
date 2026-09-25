/**
 * Source encoding declarations (PEP 263).
 *
 * Adapters read files as UTF-8. That is exact for UTF-8 and safe for any
 * ASCII-compatible single-byte encoding, because import statements are ASCII
 * and a stray high byte can't turn into a line break. Other codecs change what
 * the bytes mean: under `# coding: unicode_escape` the text `#\u000aimport x`
 * is a comment to us and a real import to CPython. Inwards can't check such a
 * file, so it reports that instead of passing it.
 */
import { DOCS_BASE } from "./meta.ts";
import type { Diagnostic, SourceFile } from "./types.ts";

export const ENCODING_RULE = {
  code: "INW000",
  name: "unsupported-encoding",
  docs: `${DOCS_BASE}/03-Architecture-C4/#rule-catalogue`,
} as const;

/** The declaration CPython's tokenizer looks for on line 1 or 2. */
const CODING = /^[ \t\f]*#.*?coding[:=][ \t]*(?<name>[-\w.]+)/u;
/** Line 1 must be blank or a comment for line 2 to count. */
const BLANK_OR_COMMENT = /^[ \t\f]*(?:#.*)?$/u;
/** ASCII-compatible codecs whose bytes read as UTF-8 can't hide an import. */
const SAFE =
  /^(?:utf-?8(?:-.*)?|ascii|us-ascii|latin-?1|iso-latin-1|iso-?8859-\d+|cp125\d|windows-125\d)$/u;

/**
 * Reads the encoding a Python file declares, the way CPython's tokenizer does.
 * Only line 1, or line 2 when line 1 is blank or a comment, can declare it.
 *
 * @param text - normalised file text.
 * @returns the declared codec name, lower-cased with `_` as `-`, or null if none.
 */
function declaredEncoding(text: string): string | null {
  const [first = "", second = ""] = text.split("\n", 2);
  const declared =
    CODING.exec(first) ?? (BLANK_OR_COMMENT.test(first) ? CODING.exec(second) : null);
  const name = declared?.groups?.["name"];
  return name ? name.toLowerCase().replaceAll("_", "-") : null;
}

/**
 * Reports a file whose declared encoding Inwards can't read faithfully.
 *
 * @param file - the source file, with normalised text.
 * @returns an INW000 diagnostic on line 1, or null when the encoding is safe or undeclared.
 */
export function checkEncoding(file: SourceFile): Diagnostic | null {
  const encoding = declaredEncoding(file.text);
  if (encoding === null || SAFE.test(encoding)) {
    return null;
  }
  return {
    code: ENCODING_RULE.code,
    rule: ENCODING_RULE.name,
    severity: "error",
    file: file.path,
    module: file.module,
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 1,
    message: `The file declares encoding "${encoding}", which can hide imports from Inwards, so its imports were not checked.`,
    fix: {
      summary: "Save the file as UTF-8 and remove the coding declaration.",
      steps: [
        "Re-encode the file as UTF-8 without changing its code.",
        "Delete the `# coding: ...` line, or change it to `# coding: utf-8`.",
      ],
    },
    docs: ENCODING_RULE.docs,
  };
}
