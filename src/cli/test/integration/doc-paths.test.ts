/**
 * @file Every `src/cli/...`, `src/core/...` and `src/vscode-extension/...` path
 * the docs and the agent guides mention exists. The packages were reorganised
 * into folders (#176), and a guide that points at a
 * file that moved sends the next agent looking in the wrong place. Accepted
 * ADR bodies are exempt: they record history, and their status column says
 * where a file went.
 */
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../../..");
/** A repo path under a package: letters, digits and path punctuation, up to a space, quote or bracket. */
const PACKAGE_PATH = /\bsrc\/(?:cli|core|vscode-extension)\/[\w./*-]*[\w/*]/gu;

/**
 * Lists the Markdown files that may name package paths: the docs in both
 * languages, the agent guides and the READMEs.
 *
 * @param dir - a directory to walk, relative to the repo.
 * @returns repo-relative Markdown paths.
 */
function markdown(dir: string): string[] {
  return readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      return markdown(rel);
    }
    return entry.name.endsWith(".md") && entry.name !== "05-ADR.md" ? [rel] : [];
  });
}

/**
 * Tells whether a mentioned path exists, reading a `*` glob as "its directory exists".
 *
 * @param path - a repo-relative path as the text spells it.
 * @returns true when the file or directory (or the glob's base) is there.
 */
function exists(path: string): boolean {
  const star = path.indexOf("*");
  return existsSync(join(REPO, star === -1 ? path : path.slice(0, star)));
}

test("every package path in the docs and guides exists", () => {
  const files = [
    ...markdown("docs/chapters"),
    ...markdown("docs/pl"),
    "AGENTS.md",
    "src/cli/AGENTS.md",
    "src/core/AGENTS.md",
    "src/vscode-extension/AGENTS.md",
    "README.md",
    "eval/README.md",
  ];
  const missing = files.flatMap((file) =>
    [...readFileSync(join(REPO, file), "utf8").matchAll(PACKAGE_PATH)]
      .map((match) => match[0])
      .filter((path) => !exists(path))
      .map((path) => `${file}: ${path}`),
  );
  expect(missing).toEqual([]);
});
