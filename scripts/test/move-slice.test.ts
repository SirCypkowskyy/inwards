/**
 * @file The import rewrite behind `move-slice.ts`, on made-up paths with no
 * disk: a moved module's importers and its own relative imports follow the
 * move, and a second run over rewritten text changes nothing. `git mv` itself
 * isn't exercised here.
 */
import { expect, test } from "bun:test";
import { rewriteSpecifiers } from "../move-slice.ts";

const MOVES = new Map([
  ["/r/src/commands/server.ts", "/r/src/lsp/cli.ts"],
  ["/r/src/lsp/session.ts", "/r/src/lsp/_session.ts"],
]);
const FILES = new Set([
  "/r/src/lsp/cli.ts",
  "/r/src/lsp/_session.ts",
  "/r/src/commands/deps.ts",
  "/r/src/main.ts",
]);

/**
 * Tells whether a made-up path is a file after the moves.
 *
 * @param path - an absolute path.
 * @returns true for a path in `FILES`.
 */
function exists(path: string): boolean {
  return FILES.has(path);
}

test("an importer follows a moved module", () => {
  const at = { file: "/r/src/main.ts", before: "/r/src/main.ts" };
  const text = 'import { serverCommand } from "./commands/server.ts";\n';
  expect(rewriteSpecifiers(text, at, MOVES, exists)).toBe(
    'import { serverCommand } from "./lsp/cli.ts";\n',
  );
});

test("a moved module's own imports follow it, dynamic ones too, and a rerun is a no-op", () => {
  const at = { file: "/r/src/lsp/cli.ts", before: "/r/src/commands/server.ts" };
  const text =
    'import type { AppDeps } from "./deps.ts";\nconst s = await import("../lsp/session.ts");\n';
  const once = rewriteSpecifiers(text, at, MOVES, exists);
  expect(once).toBe(
    'import type { AppDeps } from "../commands/deps.ts";\nconst s = await import("./_session.ts");\n',
  );
  expect(rewriteSpecifiers(once, at, MOVES, exists)).toBe(once);
});

test("a specifier that resolves to nothing, before or after, is left alone", () => {
  const at = { file: "/r/src/main.ts", before: "/r/src/main.ts" };
  const text = 'import { gone } from "./nowhere.ts";\nimport x from "node:fs";\n';
  expect(rewriteSpecifiers(text, at, MOVES, exists)).toBe(text);
});
