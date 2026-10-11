/**
 * @file `inwards init --agent claude|opencode|aider|agents-md [--launcher CMD] [--shared] [--brief] [--dry-run]`:
 * wires Inwards into a coding agent, for Claude Code either on this machine
 * (`.claude/settings.local.json`) or for the team (`--shared`: the committed
 * `.claude/settings.json` and `.mcp.json`). Every change is computed first as
 * (file, before, after), so `--dry-run` can print it and a second run finds nothing to do. Anything init
 * can't edit safely stops it with exit 2 instead of being rewritten.
 */
import { dirname, join } from "node:path";
import { type InwardsConfig, parseConfig, VERSION } from "@inwards/core";
import { print } from "../platform/print.ts";
import { findConfig } from "../project/config-discovery.ts";
import { withBrief } from "./brief.ts";
import { localClaude, sharedClaude } from "./claude.ts";
import type { Agent, Change, InitContext } from "./contracts.ts";
import { lineDiff } from "./diff.ts";
import { gitignore } from "./gitignore.ts";
import { type Exec, inwardsExec, launcherWords, shellQuoter, warnIfCached } from "./launcher.ts";
import { opencodePlugin } from "./opencode.ts";
import { readIfThere, upsertSection } from "./section.ts";

export const PRERELEASE: RegExp = /-.*$/u;
/** What `init` puts in `ignore`: tooling that belongs to no layer. */
export const DEFAULT_IGNORE: readonly string[] = ["tests", "scripts", "migrations", "conftest"];
const SECTION_BEGIN = "<!-- inwards:begin -->";
const SECTION_END = "<!-- inwards:end -->";
const TABLE_HEADER = /^[ \t]*\[[ \t]*tool[ \t]*\.[ \t]*inwards[ \t]*\][ \t]*(?:#.*)?$/mu;

/**
 * Runs init for one agent in the project whose config is found from the cwd.
 * Files go next to that pyproject.toml, even when init runs in a subdirectory.
 *
 * @param ctx - the platform and init's writer.
 * @param wiring - what to set up.
 * @param wiring.agent - which agent to wire up; undefined for `--brief` alone.
 * @param wiring.launcher - `--launcher`, the command that starts Inwards in the project (`uv run`).
 * @param wiring.shared - `--shared`: wire Claude Code through the committed files.
 * @param wiring.brief - `--brief`: also write the architecture brief into AGENTS.md.
 * @param dryRun - print the changes instead of writing them.
 * @returns 0 on success, 2 without a config, with a bad `--launcher`, or with a file init can't edit safely.
 * @throws {ConfigError} when the config is invalid; when a file can't be read or written.
 */
export function initCommand(
  ctx: InitContext,
  wiring: {
    agent: Agent | undefined;
    launcher: string | undefined;
    shared: boolean;
    brief: boolean;
  },
  dryRun: boolean,
): number {
  const { streams } = ctx.io;
  const configPath = findConfig(ctx.io, ctx.io.runtime.cwd);
  if (!configPath) {
    return print(streams, "inwards init: no pyproject.toml with [tool.inwards] here or above.", 2);
  }
  const pinned = pinDefaults(ctx, configPath);
  const { agent, launcher, shared } = wiring;
  const wired =
    agent === undefined ? [] : agentChanges(ctx, { agent, launcher, shared }, dirname(configPath));
  const changes =
    typeof wired === "string" || !wiring.brief
      ? wired
      : withBrief(ctx.io, wired, { path: configPath, text: pinned.after });
  if (typeof changes === "string") {
    return print(streams, `inwards init: ${changes}`, 2);
  }
  return apply(
    ctx,
    [pinned, ...changes].filter((c) => c.before !== c.after),
    dryRun,
  );
}

/**
 * Computes what wiring one agent changes in a project, without writing:
 * the Claude Code settings or the AGENTS.md section, and the .gitignore
 * entries. For Aider it prints the `lint-cmd` line to add instead.
 *
 * Without a launcher, Claude Code and Aider get this binary's absolute path,
 * with a warning when that path is in a tool cache. With one, every agent
 * gets `<launcher> inwards` and no path. `--shared` (Claude Code only) never
 * records a path: it takes the launcher, or a bare `inwards` when one is on `PATH`.
 *
 * @param ctx - the platform, for reading the files and printing Aider's line.
 * @param wiring - what to wire up.
 * @param wiring.agent - which agent.
 * @param wiring.launcher - `--launcher`, e.g. `uv run`; undefined for the binary's path.
 * @param wiring.shared - `--shared`: the committed `.claude/settings.json` and `.mcp.json`.
 * @param project - the directory of the project's pyproject.toml.
 * @returns the changes (some may change nothing), or an error for a bad launcher or a file that can't be edited safely.
 * @throws when a file exists but can't be read.
 */
export function agentChanges(
  ctx: InitContext,
  wiring: { agent: Agent; launcher: string | undefined; shared: boolean },
  project: string,
): Change[] | string {
  const { agent } = wiring;
  const words = wiring.launcher === undefined ? undefined : launcherWords(wiring.launcher);
  if (typeof words === "string") {
    return words;
  }
  if (wiring.shared) {
    return agent === "claude"
      ? sharedClaude(ctx, words, project)
      : "--shared works with --agent claude only.";
  }
  const launcher = words?.join(" ");
  const exec = inwardsExec(ctx);
  if (launcher === undefined && agent !== "agents-md") {
    warnIfCached(ctx, exec);
  }
  const changes: Change[] = [];
  if (agent === "aider") {
    const quote = shellQuoter(ctx.io.runtime.platform);
    const cmd =
      launcher === undefined
        ? [exec.command, ...exec.args].map(quote).join(" ")
        : `${launcher} inwards`;
    print(
      ctx.io.streams,
      `Add to .aider.conf.yml:\n  lint-cmd: ${JSON.stringify(`python: ${cmd} check --format text`)}`,
      0,
    );
  } else {
    const change = agentFile(ctx, agent, project, { exec, launcher });
    if (typeof change === "string") {
      return change;
    }
    changes.push(change);
  }
  // Every agent: session state and the run log (`check --log`) both live in .inwards/.
  changes.push(gitignore(ctx, join(project, ".gitignore"), agent));
  return changes;
}

/**
 * Computes the one file an agent's wiring writes.
 *
 * @param ctx - reads the current file.
 * @param agent - Claude Code, OpenCode or an AGENTS.md reader.
 * @param project - the directory of the project's pyproject.toml.
 * @param start - how to start Inwards.
 * @param start.exec - this binary's path, used when there is no launcher.
 * @param start.launcher - `--launcher`, checked already; undefined for the path.
 * @returns the change, or an error when the file can't be edited safely or the agent takes no launcher.
 */
function agentFile(
  ctx: InitContext,
  agent: Exclude<Agent, "aider">,
  project: string,
  start: { exec: Exec; launcher: string | undefined },
): Change | string {
  const { exec, launcher } = start;
  if (agent === "claude") {
    return localClaude(ctx, project, launcher ?? exec);
  }
  if (agent === "opencode") {
    return launcher === undefined
      ? opencodePlugin(ctx, join(project, ".opencode", "plugins", "inwards.js"), exec)
      : "--launcher doesn't apply to --agent opencode yet: the plugin starts Inwards by its path, with no shell.";
  }
  return agentsSection(ctx, join(project, "AGENTS.md"), launcher);
}

/**
 * Writes the changes, or prints them as a diff.
 *
 * @param ctx - prints, and writes through init's writer.
 * @param changes - only the files whose text would change.
 * @param dryRun - print instead of writing.
 * @returns 0.
 * @throws when a file can't be written.
 */
export function apply(ctx: InitContext, changes: Change[], dryRun: boolean): number {
  const { streams } = ctx.io;
  if (changes.length === 0) {
    return print(streams, "inwards init: nothing to change.", 0);
  }
  for (const change of changes) {
    if (dryRun) {
      const diff = lineDiff(change.before ?? "", change.after);
      print(streams, `--- ${change.path}\n+++ ${change.path} (after init)\n${diff}`, 0);
    } else {
      ctx.init.files.write(change.path, change.after);
      print(streams, `inwards init: updated ${change.path}`, 0);
    }
  }
  return 0;
}

/**
 * Adds the keys `init` pins to `[tool.inwards]` when they are missing:
 * `required-version` (this release) and `ignore` (tests, scripts, migrations,
 * conftest, so INW006 doesn't warn about tooling). The result is parsed again
 * and kept only if the keys landed in the table and nothing else changed;
 * otherwise init warns and leaves the file alone.
 *
 * @param ctx - reads the file and prints the warning.
 * @param configPath - the project's pyproject.toml.
 * @returns the change (unchanged text when nothing is missing or it can't be placed safely).
 * @throws {ConfigError} when the config is invalid.
 */
function pinDefaults(ctx: InitContext, configPath: string): Change {
  const before = ctx.io.read.text(configPath);
  const config = parseConfig(before);
  const unchanged = { path: configPath, before, after: before };
  const want = {
    requiredVersion: config.requiredVersion ?? VERSION.replace(PRERELEASE, ""),
    ignore: config.ignore ?? DEFAULT_IGNORE,
  };
  const lines = [
    config.requiredVersion === undefined ? `required-version = "${want.requiredVersion}"` : "",
    config.ignore === undefined
      ? `ignore = [${DEFAULT_IGNORE.map((e) => JSON.stringify(e)).join(", ")}]`
      : "",
  ].filter((line) => line !== "");
  if (lines.length === 0) {
    return unchanged;
  }
  const header = TABLE_HEADER.exec(before);
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const at = header ? header.index + header[0].length : -1;
  const added = lines.map((line) => `${eol}${line}`).join("");
  const after = at === -1 ? before : `${before.slice(0, at)}${added}${before.slice(at)}`;
  const check = after === before ? undefined : safeParse(after);
  const landed =
    check?.requiredVersion === want.requiredVersion &&
    JSON.stringify(check.ignore) === JSON.stringify(want.ignore) &&
    unpinned(check) === unpinned(config);
  if (!landed) {
    const keys = lines.map((line) => line.split(" ")[0]).join(" and ");
    print(
      ctx.io.streams,
      `inwards init: warning: could not add ${keys} to ${configPath}; add these lines under [tool.inwards] by hand:\n  ${lines.join("\n  ")}`,
      0,
    );
    return unchanged;
  }
  return { path: configPath, before, after };
}

/**
 * Serialises a config without the keys `init` pins, to compare the rest.
 *
 * @param config - a parsed config.
 * @returns its JSON, minus `requiredVersion` and `ignore`.
 */
function unpinned(config: InwardsConfig): string {
  return JSON.stringify({ ...config, requiredVersion: undefined, ignore: undefined });
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
 * Adds or replaces the marked Inwards section in AGENTS.md. The section names
 * `inwards` without a path, since AGENTS.md is shared with the team.
 *
 * @param ctx - reads the current file.
 * @param path - the project's AGENTS.md.
 * @param launcher - what goes before `inwards` in the command, e.g. `uv run`; undefined for nothing.
 * @returns the change, or an error when the markers don't form one pair.
 */
function agentsSection(
  ctx: InitContext,
  path: string,
  launcher: string | undefined,
): Change | string {
  const before = readIfThere(ctx.io, path);
  const section = [
    SECTION_BEGIN,
    "## Architecture check (Inwards)",
    "",
    "The layers in `[tool.inwards]` (pyproject.toml) are enforced. Before you finish a task, run:",
    "",
    `    ${launcher === undefined ? "" : `${launcher} `}inwards check --format json`,
    "",
    "Exit code 1 means an import breaks a layer: follow the numbered `fix.steps` in the output.",
    "Don't edit `[tool.inwards]` to make the check pass; ask the user instead.",
    SECTION_END,
  ].join("\n");
  const result = upsertSection(before ?? "", { begin: SECTION_BEGIN, end: SECTION_END }, section);
  return "error" in result ? `${path} has ${result.error}` : { path, before, after: result.after };
}
