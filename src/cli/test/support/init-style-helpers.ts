/**
 * Shared by the `inwards init --style` tests: a fresh uv project, and ways to
 * run init and compare a project's files before and after.
 */
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { VERSION } from "@inwards/core";
import { inwards, type RunResult } from "./run.ts";

/** What `uv init --package my-app` writes (uv 0.12), so the tests don't need uv. */
export const UV_PROJECT: Record<string, string> = {
  "pyproject.toml": `[project]
name = "my-app"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.12"
dependencies = []

[project.scripts]
my-app = "my_app:main"

[build-system]
requires = ["uv_build>=0.12.0,<0.13.0"]
build-backend = "uv_build"
`,
  "README.md": "",
  ".python-version": "3.12\n",
  ".gitignore": "# Python-generated files\n__pycache__/\n\n# Virtual environments\n.venv\n",
  "src/my_app/__init__.py": 'def main() -> None:\n    print("Hello from my-app!")\n',
};

export const STYLES = ["layered", "clean", "hexagonal"] as const;
const RELEASE = VERSION.replace(/-.*$/u, "");

/**
 * Runs `inwards init` in a project.
 *
 * @param root - the project directory.
 * @param args - arguments after `init`.
 * @returns the exit code and output.
 */
export function init(root: string, ...args: string[]): RunResult {
  return inwards(["init", ...args], { cwd: root });
}

/**
 * Reads every file of a project, keyed by forward-slash path; a symlink is
 * recorded by its target, not followed.
 *
 * @param root - the project directory.
 * @returns the file texts, sorted by path.
 */
export function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  /**
   * Adds a directory's files to `out`, recursively.
   *
   * @param dir - the directory to read.
   */
  function walk(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const key = relative(root, path).split(sep).join("/");
      const entry = lstatSync(path);
      if (entry.isSymbolicLink()) {
        out[key] = `-> ${readlinkSync(path)}`; // never followed: it may lead outside
      } else if (entry.isDirectory()) {
        walk(path);
      } else {
        out[key] = readFileSync(path, "utf8");
      }
    }
  }
  walk(root);
  return out;
}

/**
 * Makes output comparable across machines: the project path becomes <ROOT>,
 * backslashes become slashes, and the release number becomes <VERSION>.
 *
 * @param text - CLI output.
 * @param root - the project directory.
 * @returns the normalised text.
 */
export function stable(text: string, root: string): string {
  // The CLI sees the cwd as the OS resolves it: /private/var for /var on macOS.
  return [realpathSync.native(root), root]
    .reduce((out, path) => out.replaceAll(path, "<ROOT>"), text)
    .replaceAll("\\", "/")
    .replaceAll(RELEASE, "<VERSION>");
}

/**
 * Runs `inwards check --format json` and keeps the summary counts.
 *
 * @param root - the project directory.
 * @returns the exit code and the violation, warning and file counts.
 */
export function checkSummary(root: string): { code: number; summary: Record<string, number> } {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  const { summary } = JSON.parse(stdout);
  const { durationMs: _, ...counts } = summary;
  return { code, summary: counts };
}
