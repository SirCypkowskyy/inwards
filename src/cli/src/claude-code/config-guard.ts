/**
 * The config guard (PreToolUse): an agent that can edit the rules isn't
 * constrained by them, so edits that would change them are denied before
 * they happen, with a reason that tells the agent to ask the user.
 *
 * - Edit, Write or MultiEdit of a pyproject.toml, in a project that uses
 *   Inwards: the edit is simulated (`edit-sim.ts`) and denied when the parsed
 *   `[tool.inwards]` table would change, appear, disappear or stop parsing.
 * - Any file tool on `.inwards/` (session state) or `inwards-baseline.json`.
 * - A Claude Code settings file (user, project or local, also through a
 *   symlink) that holds the Inwards hooks, or would get `disableAllHooks`.
 * - An edit to a protected file that can't be simulated exactly is denied too.
 * - Bash that names `.inwards`, the baseline or the settings files (unless it only reads
 *   them), or runs `inwards hook` / `inwards baseline`.
 *
 * The Bash rules are a speed bump: a shell can reach the same files in ways
 * no pattern sees, and chapter 4 says which of those nothing else catches.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { inwardsTable } from "@inwards/core";
import { isRecord } from "../json/guards.ts";
import { findConfig, isInside, realpath } from "../paths/lexical.ts";
import { BASELINE_FILE } from "../project/baseline.ts";
import { applyEdit, landingPath, lexicalPath, normalised } from "./edit-simulation.ts";
import { holdsInwardsHooks } from "./settings.ts";
import { readsOnly, runsInwards } from "./shell-reader.ts";

const SETTINGS_FILES = ["settings.json", "settings.local.json"];
/** `.inwards`, or a prefix of it (`.inw*`), as a path segment in a shell command. */
const STATE_IN_SHELL = /(?:^|[\s"'=:/\\(<>|;&`${},])\.inw/u;
const BASELINE_IN_SHELL = /inwards-baseline\.json/iu;
/** `.claude`, then a settings file somewhere after it: two searches, not one backtracking regex. */
const CLAUDE_DIR = /\.claude\b/u;
const SETTINGS_NAME = /\bsettings(?:\.local)?\.json/gu;
/** Ends every denial. The agent eval (eval/evidence.ts) counts denials by it. */
export const ASK_USER = "If this really must change, stop and ask the user to do it.";
const UNSURE =
  "Inwards can't tell what this edit does: old_string isn't in the file verbatim. Re-read the file and use its exact text.";

/**
 * Runs the guard for one PreToolUse payload. If the guard itself fails, the
 * call is denied: letting it through unchecked would fail open.
 *
 * @param input - the hook payload (`tool_name`, `tool_input`, `cwd`).
 * @returns 0; a denial is printed to stdout as the PreToolUse decision JSON.
 */
export function configGuard(input: Record<string, unknown>): number {
  const project = realpath(process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
  if (!project) {
    return 0;
  }
  let reason: string | undefined;
  try {
    reason = problemWith(project, input);
  } catch (err) {
    reason = `the config guard failed (${err instanceof Error ? err.message : String(err)}).`;
  }
  if (reason !== undefined) {
    const hookSpecificOutput = {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `inwards: ${reason} ${ASK_USER}`,
    };
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput })}\n`);
  }
  return 0;
}

/**
 * Routes a tool call to the file or shell check.
 *
 * @param project - the real project root.
 * @param input - the hook payload.
 * @returns why the call is denied, or undefined to let it through.
 */
function problemWith(project: string, input: Record<string, unknown>): string | undefined {
  const toolInput = isRecord(input["tool_input"]) ? input["tool_input"] : {};
  const tool = input["tool_name"];
  if (tool === "Bash") {
    return shellProblem(project, toolInput["command"]);
  }
  const file = toolInput["file_path"];
  if (typeof file !== "string") {
    return undefined;
  }
  const cwd = typeof input["cwd"] === "string" ? input["cwd"] : project;
  const path = { lexical: lexicalPath(cwd, file), real: landingPath(cwd, file) };
  return fileProblem(project, path, (text) => applyEdit(text, tool, toolInput));
}

/**
 * Decides whether a file edit touches what the guard protects.
 *
 * @param project - the real project root.
 * @param path - the target as written and where it would land.
 * @param edit - applies the tool call to the file's normalised text.
 * @returns why the edit is denied, or undefined to let it through.
 */
function fileProblem(
  project: string,
  path: { lexical: string; real: string | undefined },
  edit: (text: string) => string | undefined,
): string | undefined {
  const spellings = [path.lexical, path.real].filter((p) => p !== undefined).map(fold);
  const state = fold(join(project, ".inwards"));
  if (spellings.some((p) => p === state || isInside(state, p))) {
    return ".inwards/ holds the session record the Stop gate relies on; it can't be edited.";
  }
  if (spellings.some((p) => basename(p) === fold(BASELINE_FILE)) && usesInwards(project)) {
    return `${BASELINE_FILE} lists the violations the user accepted; only \`inwards baseline\`, run by the user, changes it.`;
  }
  const settings = settingsPaths(project);
  const isSettings = spellings.some((p) => settings.has(p));
  const isPyproject =
    spellings.some((p) => basename(p) === "pyproject.toml") || isConfigTarget(project, path);
  if (!(isSettings || (isPyproject && usesInwards(project)))) {
    return undefined;
  }
  const target = path.real ?? path.lexical;
  const before = existsSync(target) ? normalised(readFileSync(target, "utf8")) : "";
  const after = edit(before);
  if (isSettings) {
    return settingsEditProblem(basename(target), before, after);
  }
  if (after === undefined) {
    return UNSURE;
  }
  const [was, is] = [inwardsTable(before), inwardsTable(after)];
  const involved = isRecord(was) || isRecord(is);
  return involved && canonical(was) !== canonical(is)
    ? "this edit changes [tool.inwards], the layer rules you are checked against."
    : undefined;
}

/**
 * Tells whether a file is the config under another name: a pyproject.toml
 * (at the root, or the one governing the file's directory) is a symlink to it.
 *
 * @param project - the real project root.
 * @param path - the target as written and where it would land.
 * @returns true when that config's real path is the target.
 */
function isConfigTarget(
  project: string,
  path: { lexical: string; real: string | undefined },
): boolean {
  if (path.real === undefined) {
    return false;
  }
  const configs = [join(project, "pyproject.toml"), findConfig(dirname(path.lexical), project)];
  return configs.some((c) => c !== undefined && realpath(c) === path.real);
}

/**
 * Decides whether an edit to a Claude Code settings file is denied.
 *
 * @param name - the file's name, for the message.
 * @param before - its current text.
 * @param after - its text after the edit, or undefined when it can't be simulated.
 * @returns why the edit is denied, or undefined to let it through.
 */
function settingsEditProblem(
  name: string,
  before: string,
  after: string | undefined,
): string | undefined {
  if (holdsInwardsHooks(before)) {
    return `${name} holds the Inwards hooks; it can't be edited.`;
  }
  if (after === undefined) {
    return UNSURE;
  }
  return disablesHooks(after) ? "disableAllHooks would switch off the Inwards hooks." : undefined;
}

/**
 * Decides whether a shell command touches what the guard protects. Only in
 * projects that use Inwards, so a user-wide hook leaves other projects alone.
 *
 * @param project - the real project root.
 * @param command - the Bash tool's `command`.
 * @returns why the command is denied, or undefined to let it through.
 */
function shellProblem(project: string, command: unknown): string | undefined {
  if (typeof command !== "string" || !usesInwards(project)) {
    return undefined;
  }
  if (runsInwards(command)) {
    return "`inwards hook` and `inwards baseline` are run by Claude Code and the user, not by the agent.";
  }
  const reason = protectedIn(command);
  return reason !== undefined && !readsOnly(command) ? reason : undefined;
}

/**
 * Tells which protected file a shell command names, if any.
 *
 * @param command - the Bash tool's `command`.
 * @returns why changing it is denied, or undefined when the command names none.
 */
function protectedIn(command: string): string | undefined {
  if (STATE_IN_SHELL.test(command)) {
    return "commands that change .inwards/ are not allowed; it holds the session record the Stop gate relies on.";
  }
  if (BASELINE_IN_SHELL.test(command)) {
    return `commands that change ${BASELINE_FILE} are not allowed; only the user takes a new baseline.`;
  }
  if (namesSettings(command)) {
    return "commands that change the Claude Code settings files are not allowed while they hold the Inwards hooks.";
  }
  return undefined;
}

/**
 * Tells whether a shell command names a Claude Code settings file: `.claude`,
 * then `settings.json` or `settings.local.json` anywhere after it. The first
 * `.claude` is enough, since any later one leaves less text to search, so the
 * time stays linear where `\.claude\b[\s\S]*\bsettings…` was quadratic.
 *
 * @param command - the Bash tool's `command`.
 * @returns true when it names one.
 */
function namesSettings(command: string): boolean {
  const dir = CLAUDE_DIR.exec(command);
  if (dir === null) {
    return false;
  }
  SETTINGS_NAME.lastIndex = dir.index + dir[0].length;
  return SETTINGS_NAME.test(command);
}

/**
 * Lists every spelling of the settings files that apply to the project: the
 * user's, the project's and the local one, as written and through symlinks.
 *
 * @param project - the real project root.
 * @returns folded paths.
 */
function settingsPaths(project: string): Set<string> {
  const userDir = process.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude");
  const paths = new Set<string>();
  for (const dir of [join(project, ".claude"), userDir]) {
    const realDir = realpath(dir);
    for (const name of SETTINGS_FILES) {
      const spellings = [
        join(dir, name),
        realpath(join(dir, name)),
        realDir && join(realDir, name),
      ];
      for (const p of spellings) {
        if (p) {
          paths.add(fold(p));
        }
      }
    }
  }
  return paths;
}

/**
 * Folds a path's case where the file system ignores it (macOS, Windows).
 *
 * @param path - a path.
 * @returns the path, lower-cased off Linux.
 */
function fold(path: string): string {
  return process.platform === "linux" ? path : path.toLowerCase();
}

/**
 * Serialises a value with object keys sorted, so reordering keys isn't a change.
 *
 * @param value - a parsed TOML value.
 * @returns its canonical JSON.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key: string, v: unknown): unknown =>
    isRecord(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

/**
 * Tells whether settings text turns every hook off.
 *
 * @param text - a settings file's text after the edit.
 * @returns true when it sets `disableAllHooks` to true.
 */
function disablesHooks(text: string): boolean {
  try {
    const settings: unknown = JSON.parse(text);
    return isRecord(settings) && settings["disableAllHooks"] === true;
  } catch {
    return false;
  }
}

/**
 * Tells whether the project uses Inwards: it has session state, or a config at its root.
 *
 * @param project - the real project root.
 * @returns true for an Inwards project.
 */
function usesInwards(project: string): boolean {
  return existsSync(join(project, ".inwards")) || findConfig(project, project) !== undefined;
}
