/**
 * @file The documents the client syncs (#348): Python, pyproject.toml, and the
 * Markdown, Mermaid and PlantUML files a `diagrams` entry can list, so the
 * server can check a diagram as it is typed. The globs are matched with Bun's
 * own glob, which reads the same syntax as VS Code's for these patterns.
 */
import { expect, test } from "bun:test";
import { DOCUMENT_SELECTOR } from "../src/client/selector.ts";

/**
 * Tells whether a file path is synced through one of the selector's patterns.
 *
 * @param path - a path with forward slashes.
 * @returns true when a pattern matches it.
 */
function synced(path: string): boolean {
  return DOCUMENT_SELECTOR.some(
    (entry) => entry.pattern !== undefined && new Bun.Glob(entry.pattern).match(path),
  );
}

test("diagram files and pyproject.toml are synced by pattern; other files aren't", () => {
  for (const path of [
    "/work/app/docs/architecture.md",
    "/work/app/docs/layers.mmd",
    "/work/app/docs/layers.mermaid",
    "/work/app/docs/components.puml",
    "/work/app/docs/components.plantuml",
    "/work/app/docs/components.pu",
    "/work/app/docs/components.iuml",
    "/work/app/README.markdown",
    "/work/app/pyproject.toml",
  ]) {
    expect(synced(path)).toBe(true);
  }
  for (const path of ["/work/app/package.json", "/work/app/notes.txt", "/work/app/app.ts"]) {
    expect(synced(path)).toBe(false);
  }
});

test("Python and Markdown documents are synced by language, on disk only", () => {
  const languages = DOCUMENT_SELECTOR.flatMap((entry) => entry.language ?? []);
  expect(languages).toEqual(["python", "markdown"]);
  expect(DOCUMENT_SELECTOR.every((entry) => entry.scheme === "file")).toBe(true);
});
