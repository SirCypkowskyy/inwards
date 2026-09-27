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

import type { Diagnostic, SourceFile } from "../contracts/records.ts";
import { diagnostic, RULES } from "../meta/registry.ts";
import { unreadableEncoding } from "../python/encoding.ts";

/**
 * Reports a file whose declared encoding Inwards can't read faithfully.
 *
 * @param file - the source file, with normalised text.
 * @returns an INW000 diagnostic on line 1, or null when the encoding is safe or undeclared.
 */
export function checkEncoding(file: SourceFile): Diagnostic | null {
  const encoding = unreadableEncoding(file.text);
  if (encoding === null) {
    return null;
  }
  const lineOne = { line: 1, column: 1, endLine: 1, endColumn: 1 };
  const message = `The file declares encoding "${encoding}", which can hide imports from Inwards, so its imports were not checked.`;
  const fix = {
    summary: "Save the file as UTF-8 and remove the coding declaration.",
    steps: [
      "Re-encode the file as UTF-8 without changing its code.",
      "Delete the `# coding: ...` line, or change it to `# coding: utf-8`.",
    ],
  };
  return diagnostic(RULES.INW000, file, { span: lineOne, message, fix });
}
