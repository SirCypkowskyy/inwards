/**
 * What `inwards init --style` prints once it has written: the package as a
 * tree annotated with each layer and what it may import, then the result of
 * a check run in process, then what to try next.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { print } from "../adapters/stdio.ts";
import { posix } from "../paths/lexical.ts";
import { runCheck } from "../project/check.ts";
import { AGENTS } from "./agents.ts";
import type { InitPlan } from "./style.ts";
import { drawTree, MISSING, type Style } from "./styles.ts";

/** A project init has just configured: its pyproject.toml, the preset, the package and the config root. */
interface Setup {
  configPath: string;
  style: Style;
  pkg: string;
  root: string;
}

/**
 * Prints what was set up: the annotated tree, the check's result, and what to run next.
 *
 * @param setup - the pyproject.toml just written, the preset, the package and the config root.
 * @param plan - what was chosen, for the next steps.
 * @returns 0.
 */
export async function report(setup: Setup, plan: InitPlan): Promise<number> {
  const { configPath, style, pkg } = setup;
  const tree = annotatedTree(setup);
  print(`\n${tree}`, 0);
  const result = await runCheck(configPath, undefined, process.cwd(), { baseline: false });
  const errors = result.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = result.diagnostics.length - errors;
  const missing = tree.includes(MISSING)
    ? " Each layer marked (missing) fails the check until it has a module; `--scaffold` on a fresh project adds them."
    : "";
  const more = errors + warnings > 0 ? ` Run \`inwards check\` to see them.${missing}` : "";
  print(
    `\ninwards check: ${plural(errors, "violation")}, ${plural(warnings, "warning")}.${more}`,
    0,
  );
  const bootstrap = `${pkg}.${style.example.bootstrap}`;
  const next = [
    plan.scaffold ? `Try the example: uv run python -m ${bootstrap} book 2` : "",
    plan.agent === undefined ? `Wire an agent: inwards init --agent ${AGENTS.join("|")}` : "",
  ].filter((line) => line !== "");
  if (next.length > 0) {
    print(`\n${next.join("\n")}`, 0);
  }
  return 0;
}

/**
 * Counts something in words.
 *
 * @param n - how many.
 * @param word - the singular noun.
 * @returns e.g. `1 warning`, `0 violations`.
 */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Draws the package as a tree of the layer packages, each with its layer and
 * what it may import, e.g. `├── domain/   domain: imports no other layer`.
 * A layer module missing on disk is marked, since its prefix matches nothing.
 *
 * @param setup - the pyproject.toml, the preset, the package and the config root.
 * @returns the tree, headed by the package's path relative to the project.
 */
function annotatedTree(setup: Setup): string {
  const { style, pkg, root } = setup;
  const project = dirname(setup.configPath);
  const base = resolve(project, root, ...pkg.split("."));
  return drawTree(style, `${posix(relative(project, base))}/  (${style.name})`, (parts) => {
    const path = join(base, ...parts);
    if (isDir(path)) {
      return "dir";
    }
    return existsSync(`${path}.py`) ? "file" : "missing";
  });
}

/**
 * Tells whether a path is a directory.
 *
 * @param path - any path.
 * @returns true for an existing directory.
 */
export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
