/**
 * `inwards init --agent claude|aider|agents-md [--dry-run]`: wires Inwards into
 * a coding agent. Every change is computed first as (file, before, after), so
 * `--dry-run` can print it and a second run finds nothing to do. Anything init
 * can't edit safely stops it with exit 2 instead of being rewritten.
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

/** How to start this Inwards without a shell: an executable and its leading arguments. */
interface Exec {
  command: string;
  args: string[];
}

/**
 * Claude Code hook events Inwards handles, with the tool matcher each needs.
 * Only events the hook implements are installed, so init never swaps a
 * working setup for a no-op: the Stop gate (#20) and the config guard's
 * PreToolUse (#23) add their entries here, and re-running init installs them.
 */
const CLAUDE_HOOKS: readonly [event: string, matcher: string | undefined][] = [
  ["SessionStart", undefined],
  ["PostToolUse", "Edit|Write|MultiEdit"],
];
const HOOK_ARGS = ["hook", "claude-code"];
const EXE_SUFFIX = /\.exe$/iu;
const PRERELEASE = /-.*$/u;
const INWARDS_BINARY = /^inwards/iu;
const LINE_BREAK = /\r?\n/u;
const SECTION_BEGIN = "<!-- inwards:begin -->";
const SECTION_END = "<!-- inwards:end -->";
const TABLE_HEADER = /^[ \t]*\[[ \t]*tool[ \t]*\.[ \t]*inwards[ \t]*\][ \t]*(?:#.*)?$/mu;

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
 * Runs init for one agent in the project whose config is found from the cwd.
 * Files go next to that pyproject.toml, even when init runs in a subdirectory.
 *
 * @param agent - which agent to wire up.
 * @param dryRun - print the changes instead of writing them.
 * @returns 0 on success, 2 without a config or with a file init can't edit safely.
 */
export function initCommand(agent: Agent, dryRun: boolean): number {
  const configPath = findConfig(process.cwd());
  if (!configPath) {
    return print("inwards init: no pyproject.toml with [tool.inwards] here or above.", 2);
  }
  const project = dirname(configPath);
  const exec = inwardsExec();
  const changes: Change[] = [requiredVersion(configPath)];
  if (agent === "aider") {
    const cmd = [exec.command, ...exec.args].map(shellQuote).join(" ");
    print(
      `Add to .aider.conf.yml:\n  lint-cmd: ${JSON.stringify(`python: ${cmd} check --format text`)}`,
      0,
    );
  } else {
    const change =
      agent === "claude"
        ? // settings.local.json: the hook holds this machine's binary path, so it must not be committed.
          claudeSettings(join(project, ".claude", "settings.local.json"), exec)
        : agentsSection(join(project, "AGENTS.md"));
    if (typeof change === "string") {
      return print(`inwards init: ${change}`, 2);
    }
    changes.push(change);
    if (agent === "claude") {
      changes.push(gitignore(join(project, ".gitignore")));
    }
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
      const diff = lineDiff(change.before ?? "", change.after);
      print(`--- ${change.path}\n+++ ${change.path} (after init)\n${diff}`, 0);
    } else {
      mkdirSync(dirname(change.path), { recursive: true });
      writeFileSync(change.path, change.after);
      print(`inwards init: updated ${change.path}`, 0);
    }
  }
  return 0;
}

/**
 * How to start this Inwards with no shell and no PATH lookup: the binary, or
 * Bun plus main.ts when running from source.
 *
 * @returns the executable and leading arguments.
 */
function inwardsExec(): Exec {
  const exe = process.execPath;
  const fromSource = basename(exe).replace(EXE_SUFFIX, "") === "bun";
  return fromSource
    ? { command: exe, args: [resolve(import.meta.dir, "main.ts")] }
    : { command: exe, args: [] };
}

/**
 * Quotes one word for a POSIX shell, or for cmd/PowerShell on Windows.
 *
 * @param word - a path or argument.
 * @returns the quoted word.
 */
function shellQuote(word: string): string {
  return process.platform === "win32" ? `"${word}"` : `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * Pins `required-version` to this release in `[tool.inwards]`, unless already set.
 * The result is parsed again and kept only if the key landed in the table and
 * nothing else changed; otherwise init warns and leaves the file alone.
 *
 * @param configPath - the project's pyproject.toml.
 * @returns the change (unchanged text when the key exists or can't be placed safely).
 */
function requiredVersion(configPath: string): Change {
  const before = readFileSync(configPath, "utf8");
  const config = parseConfig(before);
  const unchanged = { path: configPath, before, after: before };
  if (config.requiredVersion !== undefined) {
    return unchanged;
  }
  const version = VERSION.replace(PRERELEASE, "");
  const header = TABLE_HEADER.exec(before);
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const at = header ? header.index + header[0].length : -1;
  const after =
    at === -1
      ? before
      : `${before.slice(0, at)}${eol}required-version = "${version}"${before.slice(at)}`;
  const check = after === before ? undefined : safeParse(after);
  const landed =
    check?.requiredVersion === version &&
    JSON.stringify({ ...check, requiredVersion: undefined }) === JSON.stringify(config);
  if (!landed) {
    print(
      `inwards init: warning: could not add required-version to ${configPath}; add \`required-version = "${version}"\` under [tool.inwards] by hand.`,
      0,
    );
    return unchanged;
  }
  return { path: configPath, before, after };
}

/**
 * Parses a config, returning undefined instead of throwing.
 *
 * @param text - pyproject.toml text.
 * @returns the parsed config, or undefined when it doesn't parse.
 */
function safeParse(text: string): ReturnType<typeof parseConfig> | undefined {
  try {
    return parseConfig(text);
  } catch {
    return undefined;
  }
}

/**
 * Merges the Inwards hooks into Claude Code's local project settings.
 * Our old entries are removed wherever they are and one fresh group per event
 * is appended, so matchers stay right and duplicates go away. Anything that
 * isn't the documented shape stops init rather than being rewritten.
 *
 * @param path - `.claude/settings.local.json`.
 * @param exec - how to start Inwards.
 * @returns the change, or an error message.
 */
function claudeSettings(path: string, exec: Exec): Change | string {
  const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  let settings: unknown;
  try {
    settings = before === undefined ? {} : JSON.parse(before);
  } catch {
    return `${path} is not valid JSON; fix it first`;
  }
  if (!isRecord(settings)) {
    return `${path} is not a JSON object`;
  }
  const hooks = settings["hooks"] ?? {};
  if (!isRecord(hooks)) {
    return `"hooks" in ${path} is not an object; fix it first`;
  }
  for (const [event, matcher] of CLAUDE_HOOKS) {
    const groups = hooks[event] ?? [];
    if (!Array.isArray(groups)) {
      return `"hooks.${event}" in ${path} is not a list; fix it first`;
    }
    const hook = { type: "command", command: exec.command, args: [...exec.args, ...HOOK_ARGS] };
    const kept = groups.map(withoutOurHook).filter((g) => g !== undefined);
    kept.push(matcher === undefined ? { hooks: [hook] } : { matcher, hooks: [hook] });
    hooks[event] = kept;
  }
  settings["hooks"] = hooks;
  return { path, before, after: `${JSON.stringify(settings, null, 2)}\n` };
}

/**
 * Removes Inwards hook entries from one matcher group.
 *
 * @param group - one element of an event's list.
 * @returns the group without our entries, or undefined when nothing else was in it.
 */
function withoutOurHook(group: unknown): unknown {
  if (!(isRecord(group) && Array.isArray(group["hooks"]))) {
    return group;
  }
  const others = group["hooks"].filter((entry) => !isOurHook(entry));
  return others.length === 0 ? undefined : { ...group, hooks: others };
}

/**
 * Recognises an entry init wrote: exec form, ending in `hook claude-code`, run
 * by a binary named inwards or by Bun with a main.ts. A user's own script that
 * happens to take the same arguments is left alone.
 *
 * @param entry - one hook entry.
 * @returns true for an Inwards entry.
 */
function isOurHook(entry: unknown): boolean {
  if (!(isRecord(entry) && typeof entry["command"] === "string" && Array.isArray(entry["args"]))) {
    return false;
  }
  const args: unknown[] = entry["args"];
  const tail = args.slice(-HOOK_ARGS.length);
  const runsHook = tail.length === HOOK_ARGS.length && tail.every((a, i) => a === HOOK_ARGS[i]);
  const binary = basename(entry["command"]).replace(EXE_SUFFIX, "");
  const viaSource = binary === "bun" && typeof args[0] === "string" && args[0].endsWith("main.ts");
  return runsHook && (INWARDS_BINARY.test(binary) || viaSource);
}

/**
 * Adds `.inwards/` (session state) to the project's .gitignore.
 *
 * @param path - the project's .gitignore.
 * @returns the change (unchanged when already ignored).
 */
function gitignore(path: string): Change {
  const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const text = before ?? "";
  const lines = text.split(LINE_BREAK).map((l) => l.trim());
  if (lines.includes(".inwards/") || lines.includes(".inwards")) {
    return { path, before, after: text };
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const base = text === "" || text.endsWith("\n") ? text : `${text}${eol}`;
  return { path, before, after: `${base}# Inwards session state${eol}.inwards/${eol}` };
}

/**
 * Adds or replaces the marked Inwards section in AGENTS.md. The section names
 * `inwards` without a path, since AGENTS.md is shared with the team.
 *
 * @param path - the project's AGENTS.md.
 * @returns the change, or an error when the markers don't form one pair.
 */
function agentsSection(path: string): Change | string {
  const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const text = before ?? "";
  const section = [
    SECTION_BEGIN,
    "## Architecture check (Inwards)",
    "",
    "The layers in `[tool.inwards]` (pyproject.toml) are enforced. Before you finish a task, run:",
    "",
    "    inwards check --format json",
    "",
    "Exit code 1 means an import breaks a layer: follow the numbered `fix.steps` in the output.",
    "Don't edit `[tool.inwards]` to make the check pass; ask the user instead.",
    SECTION_END,
  ].join("\n");
  const begins = text.split(SECTION_BEGIN).length - 1;
  const ends = text.split(SECTION_END).length - 1;
  if (begins === 0 && ends === 0) {
    return { path, before, after: `${text}${separator(text)}${section}\n` };
  }
  const start = text.indexOf(SECTION_BEGIN);
  const end = text.indexOf(SECTION_END, start);
  if (begins !== 1 || ends !== 1 || end === -1) {
    return `${path} has unmatched ${SECTION_BEGIN} / ${SECTION_END} markers; fix them by hand`;
  }
  const after = `${text.slice(0, start)}${section}${text.slice(end + SECTION_END.length)}`;
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
