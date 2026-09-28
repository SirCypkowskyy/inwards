/**
 * @file How `inwards init` writes the command that starts Inwards: this
 * binary's absolute path (exec form, no shell), or a launcher such as `uv run`
 * put in front of a bare `inwards`. It checks `--launcher`, which goes into
 * shell commands unquoted, and warns when the path it would record lies in a
 * tool cache. It writes no files; the agent modules use what it returns.
 */
import { basename } from "node:path";
import { LAUNCHER } from "../claude-code/settings.ts";
import { print } from "../platform/print.ts";
import type { InitContext } from "./contracts.ts";

/** How to start this Inwards without a shell: an executable and its leading arguments. */
export interface Exec {
  command: string;
  args: string[];
}

/** One word of `--launcher`: nothing a shell would read as a quote, space, variable or operator. */
const LAUNCHER_WORD = /^[\w.:@=+/-]+$/u;
const WHITESPACE = /\s+/u;
/** Tool caches whose paths go stale: uv's (`uvx`) and bunx's per-package installs. */
const TOOL_CACHES: readonly [path: RegExp, name: string][] = [
  [/[\\/]archive-v0[\\/]/u, "uv's cache"],
  [/[\\/]bunx-[^\\/]*[\\/]/u, "bunx's cache"],
];
const EXE_SUFFIX = /\.exe$/iu;

/**
 * How to start this Inwards with no shell and no PATH lookup: the binary, or
 * Bun plus main.ts when running from source.
 *
 * @param ctx - the running executable and the CLI's `main.ts`.
 * @returns the executable and leading arguments.
 */
export function inwardsExec(ctx: InitContext): Exec {
  const exe = ctx.io.runtime.execPath;
  const fromSource = basename(exe).replace(EXE_SUFFIX, "") === "bun";
  return fromSource ? { command: exe, args: [ctx.init.entry] } : { command: exe, args: [] };
}

/**
 * Checks `--launcher` and splits it into words. It goes into shell commands
 * unquoted, so each word may hold only letters, digits and `_ . : @ = + / -`,
 * and it must be a tool runner the Stop gate recognises (`uv run`,
 * `poetry run`, `uvx --from inwards`), or the gate would report the hooks missing.
 *
 * @param launcher - what was passed to `--launcher`.
 * @returns the words, or an error message.
 */
export function launcherWords(launcher: string): string[] | string {
  const words = launcher.trim().split(WHITESPACE);
  const bad = words.find((word) => !LAUNCHER_WORD.test(word));
  if (bad === undefined) {
    return LAUNCHER.test(words.join(" "))
      ? words
      : `--launcher must be a tool runner such as "uv run", "poetry run", "pdm run" or "uvx --from inwards", and ${JSON.stringify(launcher.trim())} isn't one`;
  }
  return bad === ""
    ? `--launcher needs a command, e.g. --launcher "uv run"`
    : `--launcher takes plain words (letters, digits and _ . : @ = + / -), and ${JSON.stringify(bad)} isn't one`;
}

/**
 * Warns when the path init is about to record is in a tool cache (`uvx`,
 * `bunx`), which a cache clean or the next version removes and no other
 * machine has. It names the two fixes.
 *
 * @param ctx - prints the warning.
 * @param exec - how this Inwards was started.
 */
export function warnIfCached(ctx: InitContext, exec: Exec): void {
  const path = [exec.command, ...exec.args].join(" ");
  const cache = TOOL_CACHES.find(([pattern]) => pattern.test(path))?.[1];
  if (cache !== undefined) {
    print(
      ctx.io.streams,
      `inwards init: warning: ${exec.command} is in ${cache}, so the path init records stops working when the cache is cleaned or the version changes, and exists on this machine only. Add Inwards to the project (uv add --dev inwards) and run init with --launcher "uv run", or install the release binary and run init with it.`,
      0,
    );
  }
}

/**
 * Makes the quoting for one word: a POSIX shell, or cmd/PowerShell on Windows.
 *
 * @param platform - `process.platform`.
 * @returns a function from a path or argument to the quoted word.
 */
export function shellQuoter(platform: string): (word: string) => string {
  return (word: string): string =>
    platform === "win32" ? `"${word}"` : `'${word.replaceAll("'", `'\\''`)}'`;
}
