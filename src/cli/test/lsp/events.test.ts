/**
 * @file Which file events make `inwards server` check the workspace again: module
 * files, directories, the config, the baseline and diagram files (#348) do; hidden directories,
 * compiled caches, other files and paths outside the workspace don't. The
 * test feeds paths only; no file is touched.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { needsPass } from "../../src/lsp/_events.ts";

const ROOT = join("/", "work", "project");

/**
 * Asks whether one created file needs a pass.
 *
 * @param rel - the path, relative to the workspace folder.
 * @returns the answer.
 */
function passFor(rel: string): boolean {
  return needsPass([ROOT], [{ kind: "created", path: join(ROOT, rel) }]);
}

test("module files, directories, the config, the baseline and diagrams need a pass", () => {
  for (const rel of [
    "shop/domain/order.py",
    "shop/domain/order.pyi",
    "shop/fast.so",
    "shop/billing",
    "pyproject.toml",
    "packages/api/pyproject.toml",
    "inwards-baseline.json",
    "docs/architecture.md",
    "docs/layers.mmd",
    "docs/components.puml",
  ]) {
    expect(passFor(rel)).toBe(true);
  }
});

test("hidden directories, caches, other files and outside paths don't", () => {
  for (const rel of [
    ".git/index.lock",
    ".venv/lib/python3.13/site-packages/x.py",
    ".inwards/cache/abc",
    "shop/__pycache__/order.cpython-313.pyc",
    "notes.txt",
    "docs/.drafts/architecture.md",
    "../outside.py",
  ]) {
    expect(passFor(rel)).toBe(false);
  }
});
