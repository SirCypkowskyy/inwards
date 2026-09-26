/**
 * The Stop gate: before the agent may end its turn, check what this session
 * changed, and nothing else, so a legacy repo's old violations never block.
 * A config with `stop-gate = "project"` gets a whole-project check against
 * its baseline instead, which also catches a violation in a file the session
 * never touched.
 *
 * "What changed" is every Python file the PostToolUse hook saw edited, plus
 * every file whose content hash differs from the SessionStart manifest. The
 * manifest walks layer packages without skipping anything, so a commit,
 * `git update-index --assume-unchanged`, a gitignored or untracked file, or a
 * pyvenv.cfg disguise inside a layer all show up as changed. In a changed
 * file, only violations it didn't have at session start block; the old ones
 * go along as context when the gate blocks for something else (`legacy.ts`).
 * Under `agent-suppressions = "deny"`, the default, an inline suppression
 * that wasn't there at session start hides nothing (`legacy.ts`).
 *
 * The gate also fails closed when it can't trust the session: no start
 * record, a `[tool.inwards]` table that differs from the start snapshot (a
 * `sed -i` through Bash), a changed file governed by a config that didn't
 * exist at start, or Claude Code settings that dropped the Inwards hooks. It
 * blocks a turn at most `escalate-after` times (default 3); the last block
 * tells the agent to ask the user, and the Stop after it lets the turn end
 * with the unresolved violations shown to the user (see `escalation.ts`).
 * If the gate itself fails, it blocks once with the error, then lets the turn end.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { type Diagnostic, type InwardsConfig, type Report, render } from "@inwards/core";
import { changedBaselines } from "./baseline.ts";
import { settingsProblem } from "./claude-settings.ts";
import { askUser, DEFAULT_ESCALATE_AFTER, yieldTurn } from "./escalation.ts";
import { agentSuppressions, oldErrors, oldNote, rejectedNote } from "./legacy.ts";
import { print } from "./output.ts";
import { findConfig, realpath } from "./paths.ts";
import { newLayoutErrors, preexistingShape } from "./prefixes.ts";
import { runCheck } from "./project.ts";
import { noteRun, noteSuppressions } from "./runlog.ts";
import {
  fingerprint,
  isSessionId,
  readSession,
  recordPass,
  recordStop,
  type SessionState,
} from "./session.ts";
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
  const { valid: configs, found } = projectConfigs(project);
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
  const { baselines } = state.start;
  const edited =
    baselines === undefined
      ? []
      : changedBaselines(project, Object.keys(state.start.configs), baselines);
  const problems = trustProblems(project, configs, state, edited);
  const manifest = projectManifest(project, configs);
  const changed = changedFiles(project, state, manifest);
  // A baseline changed during the session can't be trusted, so none is applied,
  // and project mode falls back to the changed files.
  const { report, old, rejected, strangers, governing } = await checkChanged(
    project,
    changed,
    { start: state.start, now: configs, found },
    edited.length === 0,
  );
  // Shape findings on files that predate the session are legacy, like old violations.
  const layout = newLayoutErrors(project, configs, state.start.manifest, manifest);
  report.diagnostics = [
    ...layout,
    ...notIn(layout, report.diagnostics).filter((d) => !preexistingShape(d, state.start.manifest)),
  ];
  noteRun(project, changed, report.diagnostics); // old errors aren't the session's
  noteSuppressions(report.suppressed?.length ?? 0, rejected);
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
  const limit = escalationLimit(state.start.configs, governing);
  const escalated = errorsOf(report).some((d) => (state.seen.get(fingerprint(d)) ?? 0) >= limit);
  const turn = { streak: active ? state.stops : 0, limit, fresh: !active, escalated };
  return blockOrYield(project, id, turn, { problems, report, old, rejected });
}

/**
 * Blocks the turn, or lets it end once the limit is reached. The last block,
 * or every block once a violation has already escalated during the session,
 * tells the agent to ask the user; after the last one, the turn ends with the
 * unresolved problems shown to the user.
 *
 * @param project - the real project root.
 * @param id - the session id.
 * @param turn - blocks so far in this turn, blocks allowed, whether this is the
 *   turn's first Stop, and whether a violation has already escalated.
 * @param found - the problems, the report, the old errors left out of it, and
 *   the findings whose suppression was rejected.
 * @returns 2 to block, 0 to let the turn end.
 */
function blockOrYield(
  project: string,
  id: string,
  turn: { streak: number; limit: number; fresh: boolean; escalated: boolean },
  found: { problems: string[]; report: Report; old: Diagnostic[]; rejected: Diagnostic[] },
): number {
  const { streak, limit, fresh, escalated } = turn;
  const { problems, report, old, rejected } = found;
  if (streak >= limit) {
    return yieldTurn(project, id, { problems, diagnostics: errorsOf(report) });
  }
  recordStop(project, id, fresh);
  const ask = escalated || streak + 1 === limit ? [askUser(limit)] : [];
  const context = [
    ...(rejected.length > 0 ? [rejectedNote(rejected)] : []),
    ...(old.length > 0 ? [oldNote(old)] : []),
  ];
  return block([...problems, ...ask, ...context], report);
}

/**
 * Picks the block limit from the session-start configs that govern the
 * changed files, so neither a config edited mid-session nor an unrelated
 * package's config can change it.
 *
 * @param configs - the configs at session start, by project-relative path.
 * @param governing - the configs the changed files fall under.
 * @returns the smallest `escalate-after` among them, or the default.
 */
function escalationLimit(
  configs: Record<string, InwardsConfig>,
  governing: readonly string[],
): number {
  const limits = governing.map((rel) => configs[rel]?.escalateAfter ?? DEFAULT_ESCALATE_AFTER);
  return limits.length === 0 ? DEFAULT_ESCALATE_AFTER : Math.min(...limits);
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
 * changed `[tool.inwards]` or baseline, or Claude Code settings without the
 * Inwards hooks.
 *
 * @param project - the real project root.
 * @param configs - the valid configs now.
 * @param state - the session state.
 * @param edited - baselines that changed during the session.
 * @returns the problems, one sentence each.
 */
function trustProblems(
  project: string,
  configs: Record<string, InwardsConfig>,
  state: SessionState,
  edited: readonly string[],
): string[] {
  const problems: string[] = [];
  if (JSON.stringify(configs) !== JSON.stringify(state.start.configs)) {
    problems.push(
      "[tool.inwards] changed during this session. Put it back as it was; if the layers really must change, ask the user to do it.",
    );
  }
  if (edited.length > 0) {
    problems.push(
      `${edited.join(", ")} changed during this session, so no baseline was applied. Tell the user; only they can restore it or take a new baseline.`,
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
 * Lists the configs the Stop gate checks in full: `stop-gate = "project"` at
 * session start, still valid now, at every path each was found at.
 *
 * @param start - the configs at session start, by project-relative path.
 * @param now - the valid configs now.
 * @param found - where each valid config was found now.
 * @returns absolute pyproject.toml paths.
 */
function wholeProject(
  start: Record<string, InwardsConfig>,
  now: Record<string, InwardsConfig>,
  found: Record<string, string[]>,
): string[] {
  return Object.entries(start)
    .filter(([rel, config]) => config.stopGate === "project" && now[rel] !== undefined)
    .flatMap(([rel]) => found[rel] ?? []);
}

/**
 * Drops the check's findings that the session comparison already reports: in
 * project mode an emptied layer comes from both, in different words, at the
 * same place in pyproject.toml. Findings of one source are never merged, so
 * an emptied prefix and a module moved out of it both stay.
 *
 * @param layout - the session comparison's findings, from `newLayoutErrors`.
 * @param found - the check's findings.
 * @returns `found` without a finding whose rule and place `layout` already has.
 */
function notIn(layout: readonly Diagnostic[], found: Diagnostic[]): Diagnostic[] {
  const spots = new Set(layout.map(spotOf));
  return found.filter((d) => !spots.has(spotOf(d)));
}

/**
 * Names a finding's rule and place.
 *
 * @param d - a finding.
 * @returns the code, file, line and column joined.
 */
function spotOf(d: Diagnostic): string {
  return `${d.code}\u0000${d.file}:${d.line}:${d.column}`;
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
 * (the config comparison reports that). A config set to `stop-gate =
 * "project"` at session start gets a whole-project check instead, changed
 * files or not, from every path it was found at, but only while the
 * baselines can be trusted: otherwise it would report every legacy violation.
 *
 * @param project - the real project root.
 * @param files - absolute changed files.
 * @param configs - the session start, with its valid and invalid configs, and the valid configs now.
 * @param configs.start - the session start.
 * @param configs.now - the valid configs now.
 * @param configs.found - where each valid config was found now.
 * @param baseline - false to report violations the baselines accept.
 * @returns the merged report without the errors the changed files already had
 *   at session start, those errors (never in a whole-project check), the
 *   findings whose inline suppression was rejected (`agent-suppressions`), each file
 *   governed by an unknown config with that config, and the project-relative
 *   configs the checked files fall under.
 */
async function checkChanged(
  project: string,
  files: string[],
  {
    start,
    now,
    found,
  }: {
    start: SessionState["start"];
    now: Record<string, InwardsConfig>;
    found: Record<string, string[]>;
  },
  baseline: boolean,
): Promise<{
  report: Report;
  old: Diagnostic[];
  rejected: Diagnostic[];
  strangers: [string, string][];
  governing: string[];
}> {
  // Targets by config path; undefined checks the whole project.
  const byConfig = new Map<string, string[] | undefined>();
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
  for (const path of baseline ? wholeProject(start.configs, now, found) : []) {
    byConfig.set(path, undefined);
  }
  const reports = await Promise.all(
    [...byConfig].map(async ([config, group]) => {
      const check = { configPath: config, base: project, baseline };
      const { report, rejected } = await agentSuppressions(
        project,
        start,
        check,
        await runCheck(config, group, project, { baseline }),
      );
      const old = group ? await oldErrors(project, start, check, report.diagnostics) : [];
      const diagnostics = report.diagnostics.filter((d) => !old.includes(d));
      return { ...report, diagnostics, old, rejected };
    }),
  );
  return {
    old: reports.flatMap((r) => r.old),
    rejected: reports.flatMap((r) => r.rejected),
    report: {
      diagnostics: reports.flatMap((r) => r.diagnostics),
      suppressed: reports.flatMap((r) => r.suppressed ?? []),
      filesChecked: reports.reduce((n, r) => n + r.filesChecked, 0),
      durationMs: Math.max(0, ...reports.map((r) => r.durationMs)),
    },
    strangers,
    governing: [...byConfig.keys()].map((config) => projectPath(project, config)),
  };
}
