/**
 * @file The Stop gate: before the agent may end its turn, check what this session
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
 * go along as context when the gate blocks for something else (`session/old-errors.ts`).
 * Under `agent-suppressions = "deny"`, the default, an inline suppression
 * that wasn't there at session start hides nothing (`session/agent-suppressions.ts`).
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
import { join } from "node:path";
import { type Diagnostic, type InwardsConfig, type Report, render } from "@inwards/core";
import type { Platform } from "../platform/contracts.ts";
import { print } from "../platform/print.ts";
import { changedBaselines } from "../project/baseline.ts";
import { projectConfigs, projectManifest } from "../project/snapshot.ts";
import { rejectedNote } from "../session/agent-suppressions.ts";
import { fingerprint } from "../session/fingerprint.ts";
import { newLayoutErrors, preexistingShape } from "../session/layout-changes.ts";
import { createStartLookups } from "../session/lookups.ts";
import { oldNote } from "../session/old-errors.ts";
import {
  isSessionId,
  readSession,
  recordPass,
  recordStop,
  type SessionState,
} from "../session/record.ts";
import { changedFiles, checkChanged } from "./changed-files.ts";
import { askUser, DEFAULT_ESCALATE_AFTER, yieldTurn } from "./escalation.ts";
import { type HookDeps, hookProject } from "./protocol.ts";
import { settingsProblem } from "./settings.ts";

/**
 * Runs the Stop gate for one hook payload. An error inside the gate blocks
 * once with the message, then lets the turn end (exit 1, shown to the user),
 * so a broken gate can't keep a session going forever.
 *
 * @param deps - the platform, this invocation's run log and the check runner.
 * @param input - the Stop payload (`session_id`, `stop_hook_active`).
 * @returns 2 to keep the agent working (reasons on stderr), 1 to end the turn
 *   with a message to the user, 0 to let it end quietly.
 */
export async function stopGate(deps: HookDeps, input: Record<string, unknown>): Promise<number> {
  const active = input["stop_hook_active"] === true;
  const { streams } = deps.io;
  try {
    return await gate(deps, input, active);
  } catch (err) {
    const why = `inwards: the Stop gate failed: ${err instanceof Error ? err.message : String(err)}`;
    return active
      ? print(streams, `${why}. The turn ends unchecked; run \`inwards check\`.`, 1)
      : print(streams, `${why}. Run \`inwards check\`, fix what it reports, and tell the user.`, 2);
  }
}

/**
 * The gate proper, see the module comment.
 *
 * @param deps - the platform, this invocation's run log and the check runner.
 * @param input - the Stop payload.
 * @param active - `stop_hook_active`: this turn was already kept going by a Stop hook.
 * @returns the exit code, as for `stopGate`.
 * @throws when the project, the state or a check fails; `stopGate` turns that into one block.
 */
async function gate(
  deps: HookDeps,
  input: Record<string, unknown>,
  active: boolean,
): Promise<number> {
  const { io } = deps;
  const project = hookProject(io);
  const id = input["session_id"];
  if (!project) {
    return 0;
  }
  const { valid: configs, found } = projectConfigs(io, project);
  const state = isSessionId(id) ? readSession(io, project, id) : undefined;
  if (!(isSessionId(id) && state)) {
    if (Object.keys(configs).length === 0 || active) {
      return 0; // not an Inwards project, or the last safety valve after a block
    }
    return block(
      io,
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
      : changedBaselines(io, project, Object.keys(state.start.configs), baselines);
  const problems = trustProblems(io, project, state, { configs, edited });
  const { report, old, rejected, strangers, governing, changed } = await review(
    deps,
    project,
    state,
    { configs, found, edited },
  );
  deps.runlog.noteRun(project, changed, report.diagnostics); // old errors aren't the session's
  deps.runlog.noteSuppressions(report, rejected);
  for (const [file, config] of strangers) {
    problems.push(
      `${file} is governed by ${config}, which didn't exist when the session started, so its layers can't be trusted. Ask the user about it.`,
    );
  }
  if (problems.length === 0 && !report.diagnostics.some((d) => d.severity === "error")) {
    if (state.stops > 0) {
      recordPass(io, project, id); // ends the streak, so a later turn starts counting at 0
    }
    return 0;
  }
  const limit = escalationLimit(state.start.configs, governing);
  const escalated = errorsOf(report).some((d) => (state.seen.get(fingerprint(d)) ?? 0) >= limit);
  const turn = { streak: active ? state.stops : 0, limit, fresh: !active, escalated };
  return blockOrYield(io, { project, id }, turn, { problems, report, old, rejected });
}

/**
 * Checks what the session changed, with one set of start lookups for this
 * invocation: the changed files against their session-start configs (or the
 * whole project, for `stop-gate = "project"`), plus the layout comparison
 * with the session start. Shape findings on files that predate the session
 * are legacy, like old violations. A baseline changed during the session
 * can't be trusted, so none is applied, and project mode falls back to the
 * changed files.
 *
 * @param deps - the platform and the check runner.
 * @param project - the real project root.
 * @param state - the session state.
 * @param now - the valid configs now, where each was found, and the baselines
 *   that changed during the session.
 * @param now.configs - the valid configs now.
 * @param now.found - where each was found.
 * @param now.edited - baselines that changed during the session.
 * @returns the report, the old errors, the rejected suppressions, the files
 *   under configs unknown at start, the governing configs, and the changed files.
 * @throws when a config or a changed file can't be read, or a check fails.
 */
async function review(
  deps: HookDeps,
  project: string,
  state: SessionState,
  {
    configs,
    found,
    edited,
  }: {
    configs: Record<string, InwardsConfig>;
    found: Record<string, string[]>;
    edited: readonly string[];
  },
): Promise<Awaited<ReturnType<typeof checkChanged>> & { changed: string[] }> {
  const { io } = deps;
  const manifest = projectManifest(io, project, configs);
  const lookups = createStartLookups({ ...io, check: deps.check }, project);
  const changed = changedFiles(io, lookups, state, manifest);
  const checked = await checkChanged(
    lookups,
    changed,
    { start: state.start, now: configs, found },
    edited.length === 0,
  );
  const texts = Object.fromEntries(
    Object.keys(configs).map((rel) => [rel, io.read.text(join(project, rel))]),
  );
  const layout = newLayoutErrors(
    project,
    { valid: configs, texts },
    state.start.manifest,
    manifest,
  );
  checked.report.diagnostics = [
    ...layout,
    ...notIn(layout, checked.report.diagnostics).filter(
      (d) => !preexistingShape(lookups.identity, d, project, state.start),
    ),
  ];
  return { ...checked, changed };
}

/**
 * Blocks the turn, or lets it end once the limit is reached. The last block,
 * or every block once a violation has already escalated during the session,
 * tells the agent to ask the user; after the last one, the turn ends with the
 * unresolved problems shown to the user.
 *
 * @param io - writes the session log, the unresolved record and the output.
 * @param session - the real project root and the session id.
 * @param session.project - the real project root.
 * @param session.id - the payload's session id, which names its state files.
 * @param turn - blocks so far in this turn, blocks allowed, whether this is the
 *   turn's first Stop, and whether a violation has already escalated.
 * @param turn.streak - how many times the Stop gate has blocked this turn already.
 * @param turn.limit - how many blocks the config allows (`escalate-after`).
 * @param turn.fresh - true for the turn's first Stop, which restarts the count.
 * @param turn.escalated - a violation has already reached the limit this session.
 * @param found - the problems, the report, the old errors left out of it, and
 *   the findings whose suppression was rejected.
 * @param found.problems - session problems that aren't diagnostics.
 * @param found.report - the check of what the session changed.
 * @param found.old - errors the changed files already had at session start.
 * @param found.rejected - findings whose inline suppression wasn't honoured.
 * @returns 2 to block, 0 to let the turn end.
 */
function blockOrYield(
  io: Platform,
  { project, id }: { project: string; id: string },
  turn: { streak: number; limit: number; fresh: boolean; escalated: boolean },
  found: { problems: string[]; report: Report; old: Diagnostic[]; rejected: Diagnostic[] },
): number {
  const { streak, limit, fresh, escalated } = turn;
  const { problems, report, old, rejected } = found;
  if (streak >= limit) {
    return yieldTurn(io, project, id, { problems, diagnostics: errorsOf(report) });
  }
  recordStop(io, project, id, fresh);
  const ask = escalated || streak + 1 === limit ? [askUser(limit)] : [];
  const context = [
    ...(rejected.length > 0 ? [rejectedNote(rejected)] : []),
    ...(old.length > 0 ? [oldNote(old)] : []),
  ];
  return block(io, [...problems, ...ask, ...context], report);
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
 * @param io - reads the Claude Code settings and knows where the user's live.
 * @param project - the real project root.
 * @param state - the session state.
 * @param now - the valid configs now, and the baselines that changed during the session.
 * @param now.configs - the valid configs now.
 * @param now.edited - baselines that changed during the session.
 * @returns the problems, one sentence each.
 */
function trustProblems(
  io: Pick<Platform, "read" | "runtime">,
  project: string,
  state: SessionState,
  { configs, edited }: { configs: Record<string, InwardsConfig>; edited: readonly string[] },
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
  const hooks = settingsProblem(io, project);
  if (hooks !== undefined) {
    problems.push(`${hooks} Restore them (\`inwards init --agent claude\`) or ask the user.`);
  }
  return problems;
}

/**
 * Reports why the turn can't end yet: plain lines for session problems, then
 * the diagnostics as the same compact JSON the PostToolUse hook prints.
 *
 * @param io - writes to stderr.
 * @param io.streams - the standard streams.
 * @param problems - reasons that aren't diagnostics.
 * @param report - the check of the changed files, if it ran.
 * @returns 2.
 */
function block(
  io: Pick<Platform, "streams">,
  problems: string[],
  report: Report | undefined,
): number {
  for (const problem of problems) {
    io.streams.err(`inwards: ${problem}\n`);
  }
  if (report && report.diagnostics.length > 0) {
    io.streams.err(`${render(report, "json", { pretty: false })}\n`);
  }
  return print(io.streams, "", 2);
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
