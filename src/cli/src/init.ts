/**
 * `inwards init --agent claude|aider|agents-md [--dry-run]`: wires Inwards into
 * a coding agent. Every change is computed first as (file, before, after), so
 * `--dry-run` can print it and a second run finds nothing to do.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { parseConfig, VERSION } from "@inwards/core";
import { lineDiff } from "./diff.ts";
import { print } from "./output.ts";
import { findConfig } from "./paths.ts";

export const AGENTS = ["claude", "aider", "agents-md"] as const;
type Agent = (typeof AGENTS)[number];

/** One file init wants to write: its current text (undefined if absent) and the new text. */
interface Change {
  path: string;
  before: string | undefined;
  after: string;
}

/**
 * Claude Code hook events Inwards handles, with the tool matcher each needs.
 * Only events the hook implements are installed, so init never replaces a
 * working setup with a no-op: the Stop gate (#20) and the config guard's
 * PreToolUse (#23) add their entries here, and re-running init installs them.
 */
const CLAUDE_HOOKS: readonly [event: string, matcher: string | undefined][] = [
  ["SessionStart", undefined],
  ["PostToolUse", "Edit|Write|MultiEdit"],
];
/** How init recognises its own hook entries when it runs again. */
const OUR_HOOK = /\bhook claude-code$/u;
const EXE_SUFFIX = /\.exe$/iu;
const PRERELEASE = /-.*$/u;
const LINE_BREAK = /\r?\n/u;
const SECTION_BEGIN = "<!-- inwards:begin -->";
const SECTION_END = "<!-- inwards:end -->";
const TABLE_HEADER = /^[ \t]*\[[ \t]*tool[ \t]*\.[ \t]*inwards[ \t]*\][ \t]*$/mu;

/**
 * Tells whether a string names an agent init supports.
 *
 * @param value - the `--agent` value.
 * @returns true for claude, aider or agents-md.
 */
export function isAgent(value: string | undefined): value is Agent {
  return AGENTS.some((agent) => agent === value);
}

/**
 * Runs init for one agent in the current project.
 *
 * @param agent - which agent to wire up.
 * @param dryRun - print the changes instead of writing them.
 * @returns 0 on success, 2 without a `[tool.inwards]` config or with an unreadable settings file.
 */
export function initCommand(agent: Agent, dryRun: boolean): number {
  const project = process.cwd();
  const configPath = findConfig(project);
  if (!configPath) {
    return print("inwards init: no pyproject.toml with [tool.inwards] here or above.", 2);
  }
  const command = inwardsCommand();
  const changes: Change[] = [requiredVersion(configPath)];
  if (agent === "claude") {
    const settings = claudeSettings(join(project, ".claude", "settings.json"), command);
    if (typeof settings === "string") {
      return print(`inwards init: ${settings}`, 2);
    }
    changes.push(settings, gitignore(join(project, ".gitignore")));
  } else if (agent === "agents-md") {
    changes.push(agentsSection(join(project, "AGENTS.md"), command));
  } else {
    print(
      `Add to .aider.conf.yml:\n  lint-cmd: "python: ${command.replaceAll('"', '\\"')} check --format text"\n` +
        `or pass: --lint-cmd 'python: ${command} check --format text'`,
      0,
    );
  }
  return apply(
    changes.filter((c) => c.before !== c.after),
    dryRun,
  );
}

/**
 * Writes the changes, or prints them as a diff.
 *
 * @param changes - only the files whose text would change.
 * @param dryRun - print instead of writing.
 * @returns 0.
 */
function apply(changes: Change[], dryRun: boolean): number {
  if (changes.length === 0) {
    return print("inwards init: nothing to change.", 0);
  }
  for (const change of changes) {
    if (dryRun) {
      print(
        `--- ${change.path}\n+++ ${change.path} (after init)\n${lineDiff(change.before ?? "", change.after)}`,
        0,
      );
    } else {
      mkdirSync(dirname(change.path), { recursive: true });
      writeFileSync(change.path, change.after);
      print(`inwards init: updated ${change.path}`, 0);
    }
  }
  return 0;
}

/**
 * The absolute command that runs this Inwards, so hooks never depend on PATH
 * or an activated virtualenv (and a shim earlier on PATH can't stand in).
 *
 * @returns the quoted binary, or the quoted Bun plus main.ts when run from source.
 */
function inwardsCommand(): string {
  const exe = process.execPath;
  const fromSource = basename(exe).replace(EXE_SUFFIX, "") === "bun";
  const main = resolve(import.meta.dir, "main.ts");
  return fromSource ? `"${exe}" "${main}"` : `"${exe}"`;
}

/**
 * Pins `required-version` to this release in `[tool.inwards]`, unless already set.
 *
 * @param configPath - the project's pyproject.toml.
 * @returns the change (unchanged text when the key exists or the table header can't be found).
 */
function requiredVersion(configPath: string): Change {
  const before = readFileSync(configPath, "utf8");
  const config = parseConfig(before);
  const header = TABLE_HEADER.exec(before);
  if (config.requiredVersion !== undefined || !header) {
    return { path: configPath, before, after: before };
  }
  const at = header.index + header[0].length;
  const after = `${before.slice(0, at)}\nrequired-version = "${VERSION.replace(PRERELEASE, "")}"${before.slice(at)}`;
  return { path: configPath, before, after };
}

/**
 * Merges the Inwards hooks into Claude Code's project settings.
 * An existing Inwards entry is updated in place; anything else is kept as is.
 *
 * @param path - `.claude/settings.json`.
 * @param command - the absolute Inwards command.
 * @returns the change, or an error message when the file isn't a JSON object.
 */
function claudeSettings(path: string, command: string): Change | string {
  const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  let settings: Record<string, unknown> = {};
  try {
    const parsed: unknown = before === undefined ? {} : JSON.parse(before);
    if (!isRecord(parsed)) {
      return `${path} is not a JSON object`;
    }
    settings = parsed;
  } catch {
    return `${path} is not valid JSON; fix it first`;
  }
  const hooks = isRecord(settings["hooks"]) ? settings["hooks"] : {};
  for (const [event, matcher] of CLAUDE_HOOKS) {
    hooks[event] = withOurHook(hooks[event], matcher, `${command} hook claude-code`);
  }
  settings["hooks"] = hooks;
  return { path, before, after: `${JSON.stringify(settings, null, 2)}\n` };
}

/**
 * Puts the Inwards hook into one event's list of matcher groups.
 *
 * @param groups - the event's current value in settings.hooks.
 * @param matcher - the tool matcher Inwards needs, if the event takes one.
 * @param command - the full hook command.
 * @returns the updated list: our entry rewritten where it was, or a new group appended.
 */
function withOurHook(groups: unknown, matcher: string | undefined, command: string): unknown[] {
  const list: unknown[] = Array.isArray(groups) ? groups : [];
  let found = false;
  for (const group of list) {
    const entries = isRecord(group) && Array.isArray(group["hooks"]) ? group["hooks"] : [];
    for (const entry of entries) {
      if (
        isRecord(entry) &&
        typeof entry["command"] === "string" &&
        OUR_HOOK.test(entry["command"])
      ) {
        entry["command"] = command;
        found = true;
      }
    }
  }
  if (!found) {
    const hook = { type: "command", command };
    list.push(matcher === undefined ? { hooks: [hook] } : { matcher, hooks: [hook] });
  }
  return list;
}

/**
 * Adds `.inwards/` (session state) to the project's .gitignore.
 *
 * @param path - the project's .gitignore.
 * @returns the change (unchanged when already ignored).
 */
function gitignore(path: string): Change {
  const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const lines = (before ?? "").split(LINE_BREAK).map((l) => l.trim());
  if (lines.includes(".inwards/") || lines.includes(".inwards")) {
    return { path, before, after: before ?? "" };
  }
  const base =
    before === undefined || before.endsWith("\n") || before === "" ? (before ?? "") : `${before}\n`;
  return { path, before, after: `${base}# Inwards session state\n.inwards/\n` };
}

/**
 * Adds or replaces the marked Inwards section in AGENTS.md.
 *
 * @param path - the project's AGENTS.md.
 * @param command - the absolute Inwards command.
 * @returns the change.
 */
function agentsSection(path: string, command: string): Change {
  const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const section = [
    SECTION_BEGIN,
    "## Architecture check (Inwards)",
    "",
    "The layers in `[tool.inwards]` (pyproject.toml) are enforced. Before you finish a task, run:",
    "",
    `    ${command} check --format json`,
    "",
    "Exit code 1 means an import breaks a layer: follow the numbered `fix.steps` in the output.",
    "Don't edit `[tool.inwards]` to make the check pass; ask the user instead.",
    SECTION_END,
  ].join("\n");
  const text = before ?? "";
  const start = text.indexOf(SECTION_BEGIN);
  const end = text.indexOf(SECTION_END);
  const after =
    start !== -1 && end > start
      ? `${text.slice(0, start)}${section}${text.slice(end + SECTION_END.length)}`
      : `${text}${separator(text)}${section}\n`;
  return { path, before, after };
}

/**
 * Picks what goes between existing text and an appended section: one blank line.
 *
 * @param text - the file's current text.
 * @returns "", "\n" or "\n\n", so the result has exactly one blank line between them.
 */
function separator(text: string): string {
  if (text === "" || text.endsWith("\n\n")) {
    return "";
  }
  return text.endsWith("\n") ? "\n" : "\n\n";
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
