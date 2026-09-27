/**
 * @file Fails when a TypeScript module's `@file` overview says too little.
 * oxlint's `require-file-overview` makes sure the tag exists; this checks
 * that its prose is at least two sentences, so a reader learns what the
 * module is for and what it deliberately doesn't do (#176). Tags, inline
 * code, URLs and abbreviations such as "e.g." are left out before counting,
 * so dotted file names or version numbers don't pass for sentence ends.
 *
 * Usage: `bun run scripts/check-module-overviews.ts DIR...` (CI passes the
 * packages restructured so far). Exit 0 when every module passes, 1 otherwise.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

const ROOT = join(import.meta.dir, "..");
const MIN_SENTENCES = 2;
const LEADING_BLOCK = /^(?:#![^\n]*\n)?\s*\/\*\*([\s\S]*?)\*\//u;
const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|vs|cf)\./giu;
const INLINE_CODE = /`[^`]*`/gu;
const URL = /\bhttps?:\/\/[^\s]*[^\s.,;:!?]/gu;
const SENTENCE_END = /[.!?](?=\s|$)/gu;

/**
 * Lists every TypeScript module below a directory, declarations excluded.
 *
 * @param dir - the directory to walk.
 * @returns absolute paths.
 */
function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["node_modules", "fixtures", "__snapshots__"].includes(entry.name)
        ? []
        : modules(path);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/**
 * Extracts the prose of a module's leading overview: the `@file` text and
 * the lines that follow it, up to the next tag, with the comment stars gone.
 *
 * @param text - the module's source.
 * @returns the prose, or undefined when there is no leading `@file` block.
 */
export function overviewProse(text: string): string | undefined {
  const block = LEADING_BLOCK.exec(text)?.[1];
  if (block === undefined || !block.includes("@file")) {
    return undefined;
  }
  const lines = block.split("\n").map((line) => line.replace(/^\s*\*\s?/u, ""));
  const start = lines.findIndex((line) => line.includes("@file"));
  const prose: string[] = [];
  for (const [i, line] of lines.slice(start).entries()) {
    if (i > 0 && line.trimStart().startsWith("@")) {
      break;
    }
    prose.push(i === 0 ? line.replace(/^.*@file\s*/u, "") : line);
  }
  return prose.join(" ").replace(/\s+/gu, " ").trim();
}

/**
 * Counts the sentences in a stretch of prose.
 *
 * @param prose - the overview's text.
 * @returns how many sentence ends it has, ignoring code, URLs and abbreviations.
 */
export function sentences(prose: string): number {
  const plain = prose.replace(INLINE_CODE, "x").replace(URL, "x").replace(ABBREVIATIONS, "eg");
  return plain.match(SENTENCE_END)?.length ?? 0;
}

if (import.meta.main) {
  const dirs = process.argv.slice(2);
  const failures = dirs
    .flatMap((dir) => modules(join(ROOT, dir)))
    .flatMap((file) => {
      const prose = overviewProse(readFileSync(file, "utf8"));
      const count = prose === undefined ? 0 : sentences(prose);
      return count >= MIN_SENTENCES ? [] : [`${relative(ROOT, file)}: ${count} sentence(s)`];
    });
  for (const failure of failures) {
    process.stderr.write(`module overview too short (${MIN_SENTENCES}+ sentences): ${failure}\n`);
  }
  process.stdout.write(failures.length === 0 ? "Every module overview has 2+ sentences.\n" : "");
  process.exitCode = failures.length === 0 ? 0 : 1;
}
