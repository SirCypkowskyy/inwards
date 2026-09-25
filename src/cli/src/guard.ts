/**
 * The config guard (PreToolUse): an agent that can edit the rules isn't
 * constrained by them, so edits that would change them are denied before
 * they happen, with a reason that tells the agent to ask the user.
 *
 * - Edit, Write or MultiEdit of any pyproject.toml in the project: the edit is
 *   applied in memory and denied when the parsed `[tool.inwards]` table
 *   differs (added, removed, changed or made unparseable).
 * - Any tool on `.inwards/` (session state), or on a Claude Code settings file
 *   (user, project, local) that holds the Inwards hooks or would get
 *   `disableAllHooks`.
 * - Bash that names `.inwards`, the Claude Code settings files, or runs
 *   `inwards hook` / `inwards baseline`.
 *
 * Bash can reach the same files in ways no pattern sees (`python -c ...`), so
 * the Bash rules are a speed bump; the Stop gate re-checks the config, the
 * hooks and every changed file before the turn ends.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { inwardsTable } from "@inwards/core";
import { isOurHook } from "./claude-settings.ts";
import { findConfig, isInside, physicalRealpath, realpath } from "./paths.ts";

const SETTINGS_FILES: ReadonlySet<string> = new Set(["settings.json", "settings.local.json"]);
/** `.inwards` as a path segment in a shell command. */
const STATE_IN_SHELL = /(?:^|[\s"'=:/\\(<>|;&`$])\.inwards(?:$|[\s"'/\\;&|)<>`])/u;
const SETTINGS_IN_SHELL = /\.claude[/\\]+settings(?:\.local)?\.json/u;
const INWARDS_COMMAND = /\binwards(?:\.exe)?["']?\s+(?:hook|baseline)\b/u;
const ASK_USER = "If this really must change, stop and ask the user to do it.";

/**
 * Runs the guard for one PreToolUse payload.
 *
 * @param input - the hook payload (`tool_name`, `tool_input`, `cwd`).
 * @returns 0; a denial is printed to stdout as the PreToolUse decision JSON.
 */
export function configGuard(input: Record<string, unknown>): number {
  const project = realpath(process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
  const tool = input["tool_name"];
  const toolInput = isRecord(input["tool_input"]) ? input["tool_input"] : {};
  if (!project) {
    return 0;
  }
  const cwd = typeof input["cwd"] === "string" ? input["cwd"] : project;
  const reason =
    tool === "Bash"
      ? shellProblem(project, toolInput["command"])
      : fileProblem(project, cwd, tool, toolInput);
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
 * Decides whether a file edit touches what the guard protects.
 *
 * @param project - the real project root.
 * @param cwd - the directory a relative `file_path` is resolved against.
 * @param tool - the tool name.
 * @param toolInput - the tool's input.
 * @returns why the edit is denied, or undefined to let it through.
 */
function fileProblem(
  project: string,
  cwd: string,
  tool: unknown,
  toolInput: Record<string, unknown>,
): string | undefined {
  const file = toolInput["file_path"];
  if (typeof file !== "string") {
    return undefined;
  }
  const target = landingPath(cwd, file);
  if (target === undefined || !(isInside(project, target) || isSettingsFile(project, target))) {
    return undefined;
  }
  if (target === join(project, ".inwards") || isInside(join(project, ".inwards"), target)) {
    return ".inwards/ holds the session record the Stop gate relies on; it can't be edited.";
  }
  const before = existsSync(target) ? readFileSync(target, "utf8") : "";
  const after = applyEdit(before, tool, toolInput);
  if (isSettingsFile(project, target)) {
    return settingsEditProblem(basename(target), before, after);
  }
  const changed =
    basename(target) === "pyproject.toml" &&
    after !== undefined &&
    JSON.stringify(inwardsTable(before)) !== JSON.stringify(inwardsTable(after));
  return changed
    ? "this edit changes [tool.inwards], the layer rules you are checked against."
    : undefined;
}

/**
 * Decides whether an edit to a Claude Code settings file is denied.
 *
 * @param name - the file's name, for the message.
 * @param before - its current text.
 * @param after - its text after the edit, or undefined when the edit would fail.
 * @returns why the edit is denied, or undefined to let it through.
 */
function settingsEditProblem(
  name: string,
  before: string,
  after: string | undefined,
): string | undefined {
  if (holdsOurHooks(before)) {
    return `${name} holds the Inwards hooks; it can't be edited.`;
  }
  return after !== undefined && disablesHooks(after)
    ? "disableAllHooks would switch off the Inwards hooks."
    : undefined;
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
  if (STATE_IN_SHELL.test(command)) {
    return "commands on .inwards/ are not allowed; it holds the session record the Stop gate relies on.";
  }
  if (SETTINGS_IN_SHELL.test(command)) {
    return "commands on the Claude Code settings files are not allowed while they hold the Inwards hooks.";
  }
  if (INWARDS_COMMAND.test(command)) {
    return "`inwards hook` and `inwards baseline` are run by Claude Code and the user, not by the agent.";
  }
  return undefined;
}

/**
 * Applies an Edit, Write or MultiEdit to a file's text, as the tool would.
 * Claude Code matches CRLF files with LF strings, so both spellings are tried.
 *
 * @param before - the current text ("" for a new file).
 * @param tool - the tool name.
 * @param input - the tool's input.
 * @returns the new text, or undefined when the tool would fail (then there's nothing to guard).
 */
function applyEdit(
  before: string,
  tool: unknown,
  input: Record<string, unknown>,
): string | undefined {
  if (tool === "Write") {
    return typeof input["content"] === "string" ? input["content"] : undefined;
  }
  let edits: unknown;
  if (tool === "MultiEdit") {
    edits = input["edits"];
  } else if (tool === "Edit") {
    edits = [input];
  }
  if (!Array.isArray(edits)) {
    return undefined;
  }
  let text: string | undefined = before;
  for (const edit of edits) {
    text = text === undefined || !isRecord(edit) ? undefined : replaceOnce(text, edit);
  }
  return text;
}

/**
 * Applies one `old_string` → `new_string` replacement.
 *
 * @param text - the text so far.
 * @param edit - `old_string`, `new_string` and optional `replace_all`.
 * @returns the replaced text, or undefined when `old_string` isn't found.
 */
function replaceOnce(text: string, edit: Record<string, unknown>): string | undefined {
  const { old_string: from, new_string: to, replace_all: all } = edit;
  if (typeof from !== "string" || typeof to !== "string" || from === "") {
    return undefined;
  }
  const crlf = text.includes("\r\n") && !text.includes(from);
  const [a, b] = crlf ? [from.replaceAll("\n", "\r\n"), to.replaceAll("\n", "\r\n")] : [from, to];
  if (!text.includes(a)) {
    return undefined;
  }
  return all === true ? text.replaceAll(a, b) : text.replace(a, () => b);
}

/**
 * Resolves where a path would land if written: the real path of its nearest
 * existing ancestor, plus the rest. A symlink can't make `.inwards` look like
 * another directory.
 *
 * @param base - the directory a relative path is resolved against.
 * @param file - the path as given.
 * @returns the real landing path, or undefined when nothing on the way exists.
 */
function landingPath(base: string, file: string): string | undefined {
  const real = physicalRealpath(base, file);
  if (real !== undefined) {
    return real;
  }
  const full = resolve(base, file);
  const parent = dirname(full);
  if (parent === full) {
    return undefined;
  }
  const landed = landingPath(base, parent);
  return landed === undefined ? undefined : join(landed, basename(full));
}

/**
 * Tells whether a path is one of the Claude Code settings files that apply to
 * the project: the user's, the project's or the local one.
 *
 * @param project - the real project root.
 * @param target - a real path.
 * @returns true for one of the three.
 */
function isSettingsFile(project: string, target: string): boolean {
  const userDir = process.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude");
  const dirs = [join(project, ".claude"), realpath(userDir) ?? userDir];
  return SETTINGS_FILES.has(basename(target)) && dirs.includes(dirname(target));
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
 * Tells whether a Claude Code settings file currently runs Inwards.
 *
 * @param text - the settings file's current text.
 * @returns true when any hook entry in it is an Inwards hook.
 */
function holdsOurHooks(text: string): boolean {
  try {
    const settings: unknown = JSON.parse(text);
    const hooks = isRecord(settings) ? settings["hooks"] : undefined;
    return (
      isRecord(hooks) &&
      Object.values(hooks).some(
        (groups) =>
          Array.isArray(groups) &&
          groups.some(
            (group: unknown) =>
              isRecord(group) && Array.isArray(group["hooks"]) && group["hooks"].some(isOurHook),
          ),
      )
    );
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

/**
 * Tells whether a parsed JSON value is a plain object.
 *
 * @param value - any parsed JSON value.
 * @returns true for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
