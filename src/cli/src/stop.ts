/**
 * The Stop gate: before the agent may end its turn, check what this session
 * changed, and nothing else, so a legacy repo's old violations never block.
 *
 * "What changed" is every Python file the PostToolUse hook saw edited, plus
 * every file whose content hash differs from the SessionStart manifest. The
 * manifest walks layer packages without skipping anything, so a commit,
 * `git update-index --assume-unchanged`, a gitignored or untracked file, or a
 * pyvenv.cfg disguise inside a layer all show up as changed.
 *
 * The gate also fails closed when it can't trust the session: no start
 * record, a `[tool.inwards]` table that differs from the start snapshot (a
 * `sed -i` through Bash), a changed file governed by a config that didn't
 * exist at start, or Claude Code settings that dropped the Inwards hooks. It
 * blocks a turn at most `escalate-after` times (default 3); the last block
 * tells the agent to ask the user, and the Stop after it lets the turn end
 * with the unresolved violations shown to the user (see `escalation.ts`). If the gate itself fails, it
 * blocks once with the error, then lets the turn end.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { type Diagnostic, type InwardsConfig, type Report, render } from "@inwards/core";
import { settingsProblem } from "./claude-settings.ts";
import { askUser, DEFAULT_ESCALATE_AFTER, yieldTurn } from "./escalation.ts";
import { print } from "./output.ts";
import { findConfig, realpath } from "./paths.ts";
import { newPrefixErrors } from "./prefixes.ts";
import { runCheck } from "./project.ts";
import { isSessionId, readSession, recordPass, recordStop, type SessionState } from "./session.ts";
import { projectConfigs, projectManifest, projectPath } from "./snapshot.ts";

const PYTHON_FILE = /\.pyi?$/u;

/**
 * Runs the Stop gate for one hook payload. An error inside the gate blocks
 * once with the message, then lets the turn end (exit 1, shown to the user),
 * so a broken gate can't keep a session going forever.
 *
 * @param input - the Stop payload (`session_id`, `stop_hook_active`).
 * @returns 2 to keep the agent working (reasons on stderr), 1 to end the turn
 *   with a message to the user, 0 to let it end quietly.
 */
export async function stopGate(input: Record<string, unknown>): Promise<number> {
  const active = input["stop_hook_active"] === true;
  try {
    return await gate(input, active);
  } catch (err) {
    const why = `inwards: the Stop gate failed: ${err instanceof Error ? err.message : String(err)}`;
    return active
      ? print(`${why}. The turn ends unchecked; run \`inwards check\`.`, 1)
      : print(`${why}. Run \`inwards check\`, fix what it reports, and tell the user.`, 2);
  }
}

/**
 * The gate proper, see the module comment.
 *
 * @param input - the Stop payload.
 * @param active - `stop_hook_active`: this turn was already kept going by a Stop hook.
 * @returns the exit code, as for `stopGate`.
 */
async function gate(input: Record<string, unknown>, active: boolean): Promise<number> {
  const project = realpath(process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
  const id = input["session_id"];
  if (!project) {
    return 0;
  }
  const { valid: configs } = projectConfigs(project);
  const state = isSessionId(id) ? readSession(project, id) : undefined;
  if (!(isSessionId(id) && state)) {
    if (Object.keys(configs).length === 0 || active) {
      return 0; // not an Inwards project, or the last safety valve after a block
    }
    return block(
      [
        "Inwards has no record of how this session started (.inwards/state is missing), so it can't tell what you changed. Run `inwards check`, fix what it reports, and ask the user to review before finishing.",
      ],
      undefined,
    );
  }
  const problems = trustProblems(project, configs, state);
  const manifest = projectManifest(project, configs);
  const { report, strangers } = await checkChanged(
    project,
    changedFiles(project, state, manifest),
    state.start,
    configs,
  );
  report.diagnostics.unshift(...newPrefixErrors(project, configs, state.start.manifest, manifest));
  for (const [file, config] of strangers) {
    problems.push(
      `${file} is governed by ${config}, which didn't exist when the session started, so its layers can't be trusted. Ask the user about it.`,
    );
  }
  if (problems.length === 0 && !report.diagnostics.some((d) => d.severity === "error")) {
    if (state.stops > 0) {
      recordPass(project, id); // ends the streak, so a later turn starts counting at 0
    }
    return 0;
  }
  const turn = {
    streak: active ? state.stops : 0,
    limit: escalationLimit(configs),
    fresh: !active,
  };
  return blockOrYield(project, id, turn, { problems, report });
}

/**
 * Blocks the turn, or lets it end once the limit is reached. The last block
 * tells the agent to ask the user; after it, the turn ends with the
 * unresolved problems shown to the user.
 *
 * @param project - the real project root.
 * @param id - the session id.
 * @param turn - blocks so far in this turn, blocks allowed, and whether this is the turn's first Stop.
 * @param found - the problems and the report.
 * @returns 2 to block, 0 to let the turn end.
 */
function blockOrYield(
  project: string,
  id: string,
  turn: { streak: number; limit: number; fresh: boolean },
  found: { problems: string[]; report: Report },
): number {
  const { streak, limit, fresh } = turn;
  const { problems, report } = found;
  if (streak >= limit) {
    return yieldTurn(project, problems, errorsOf(report));
  }
  recordStop(project, id, fresh);
  const last = streak + 1 === limit ? [askUser(limit)] : [];
  return block([...problems, ...last], report);
}

/**
 * Picks the block limit: the smallest `escalate-after` among the configs.
 *
 * @param configs - the valid configs now.
 * @returns how many times the gate blocks a turn before escalating.
 */
function escalationLimit(configs: Record<string, InwardsConfig>): number {
  return Math.min(...Object.values(configs).map((c) => c.escalateAfter ?? DEFAULT_ESCALATE_AFTER));
}

/**
 * Keeps the errors of a report, the violations left unresolved.
 *
 * @param report - the check of the changed files.
 * @returns its error diagnostics.
 */
function errorsOf(report: Report): Diagnostic[] {
  return report.diagnostics.filter((d) => d.severity === "error");
}

/**
 * Lists what makes the session untrustworthy regardless of the code: a
 * changed `[tool.inwards]`, or Claude Code settings without the Inwards hooks.
 *
 * @param project - the real project root.
 * @param configs - the valid configs now.
 * @param state - the session state.
 * @returns the problems, one sentence each.
 */
function trustProblems(
  project: string,
  configs: Record<string, InwardsConfig>,
  state: SessionState,
): string[] {
  const problems: string[] = [];
  if (JSON.stringify(configs) !== JSON.stringify(state.start.configs)) {
    problems.push(
      "[tool.inwards] changed during this session. Put it back as it was; if the layers really must change, ask the user to do it.",
    );
  }
  const hooks = settingsProblem(project);
  if (hooks !== undefined) {
    problems.push(`${hooks} Restore them (\`inwards init --agent claude\`) or ask the user.`);
  }
  return problems;
}

/**
 * Reports why the turn can't end yet: plain lines for session problems, then
 * the diagnostics as the same compact JSON the PostToolUse hook prints.
 *
 * @param problems - reasons that aren't diagnostics.
 * @param report - the check of the changed files, if it ran.
 * @returns 2.
 */
function block(problems: string[], report: Report | undefined): number {
  for (const problem of problems) {
    process.stderr.write(`inwards: ${problem}\n`);
  }
  if (report && report.diagnostics.length > 0) {
    process.stderr.write(`${render(report, "json", { pretty: false })}\n`);
  }
  return print("", 2);
}

/**
 * Collects the Python files this session changed: the edits the hook saw and
 * the manifest diff since SessionStart.
 *
 * @param project - the real project root.
 * @param state - the session state.
 * @param manifest - the content hashes now, from `projectManifest`.
 * @returns absolute paths of changed Python files that still exist as regular files.
 */
function changedFiles(
  project: string,
  state: SessionState,
  manifest: Record<string, string>,
): string[] {
  const changed = new Set(state.edited);
  for (const [path, hash] of Object.entries(manifest)) {
    if (state.start.manifest[path] !== hash) {
      changed.add(path);
    }
  }
  return [...changed]
    .filter((path) => PYTHON_FILE.test(path))
    .map((path) => join(project, path))
    .filter((path) => existsSync(path) && statSync(path).isFile());
}

/**
 * Checks changed files, each against its own config. A file whose config
 * didn't exist at session start is not checked with it: a new nested
 * pyproject.toml with a permissive table would otherwise waive the layers.
 * A file under a config that was already invalid is skipped, since that
 * config governs nothing, and so is one under a config that is invalid now
 * (the config comparison reports that).
 *
 * @param project - the real project root.
 * @param files - absolute changed files.
 * @param start - the session start, with its valid and invalid configs.
 * @param now - the valid configs now.
 * @returns the merged report, and each file governed by an unknown config with that config.
 */
async function checkChanged(
  project: string,
  files: string[],
  start: SessionState["start"],
  now: Record<string, InwardsConfig>,
): Promise<{ report: Report; strangers: [string, string][] }> {
  const byConfig = new Map<string, string[]>();
  const strangers: [string, string][] = [];
  for (const file of files) {
    const config = findConfig(dirname(file), project);
    if (config === undefined) {
      continue;
    }
    const rel = projectPath(project, config);
    if (start.invalid?.includes(rel)) {
      continue;
    }
    if (start.configs[rel] === undefined) {
      strangers.push([projectPath(project, file), rel]);
    } else if (now[rel] !== undefined) {
      byConfig.set(config, [...(byConfig.get(config) ?? []), file]);
    }
  }
  const reports = await Promise.all(
    [...byConfig].map(([config, group]) => runCheck(config, group, project)),
  );
  return {
    report: {
      diagnostics: reports.flatMap((r) => r.diagnostics),
      filesChecked: reports.reduce((n, r) => n + r.filesChecked, 0),
      durationMs: Math.max(0, ...reports.map((r) => r.durationMs)),
    },
    strangers,
  };
}
