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
 * pyvenv.cfg disguise inside a layer all show up as changed. The symlinks in
 * layer packages are recorded too, so a link made during the session out of
 * the config root or into another layer blocks (#83, #84). In a changed
 * file, only violations it didn't have at session start block; the old ones
 * go along as context when the gate blocks for something else (`session/old-errors.ts`).
 * Under `agent-suppressions = "deny"`, the default, an inline suppression
 * that wasn't there at session start hides nothing (`session/agent-suppressions.ts`).
 *
 * The gate also fails closed when it can't trust the session: no start
 * record, a `[tool.inwards]` table that differs from the start snapshot (a
 * `sed -i` through Bash), a changed file governed by a config that didn't
 * exist at start, or Claude Code settings that dropped the Inwards hooks.
 * The start record itself is checked against its witness outside the project
 * (#88): a replayed SessionStart, a record deleted or rewritten during the
 * session, or a record without a witness whose config isn't the committed one
 * all block (`session/record.ts`, `session/committed-config.ts`). It
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
import {
  projectConfigs,
  projectLinks,
  projectManifest,
  projectTopLevel,
} from "../project/snapshot.ts";
import { rejectedNote } from "../session/agent-suppressions.ts";
import { uncommittedConfigs } from "../session/committed-config.ts";
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
import { touchWitness } from "../session/start-record.ts";
import { changedFiles, checkChanged, freshImporters, newTopLevel } from "./changed-files.ts";
import { askUser, DEFAULT_ESCALATE_AFTER, yieldTurn } from "./escalation.ts";
import { hookProblem } from "./hook-host.ts";
import { type HookDeps, hookProject } from "./protocol.ts";

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
    return Object.keys(configs).length === 0 ? 0 : unknownSession(io, project, id, active);
  }
  touchWitness(io, project, id); // a running session's witness never ages out
  const { baselines } = state.start;
  const edited =
    baselines === undefined
      ? []
      : changedBaselines(io, project, Object.keys(state.start.configs), baselines);
  const problems = trustProblems(io, project, state, { configs, edited });
  const { report, old, rejected, strangers, governing, changed } = await review(
    deps,
    { project, id },
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
 * Answers a Stop in an Inwards project that has neither a start record nor
 * its witness: block once, then let the turn end with the reason shown to the
 * user, since there is nothing to compare with.
 *
 * @param io - writes the output and the unresolved record.
 * @param project - the real project root.
 * @param id - the payload's session id, which may not be a usable one.
 * @param active - `stop_hook_active`: this turn was already kept going by a Stop hook.
 * @returns 2 to block, 0 to let the turn end.
 */
function unknownSession(io: Platform, project: string, id: unknown, active: boolean): number {
  const missing =
    "Inwards has no record of how this session started (.inwards/state is missing), so it can't tell what you changed.";
  if (active) {
    // The last safety valve after a block: the turn ends, but the user hears why.
    return isSessionId(id)
      ? yieldTurn(io, project, id, { problems: [missing], diagnostics: [] })
      : 0;
  }
  const fix =
    "Run `inwards check`, fix what it reports, and ask the user to review before finishing.";
  return block(io, [`${missing} ${fix}`], undefined);
}

/**
 * Checks what the session changed, with one set of start lookups for this
 * invocation: the changed files against their session-start configs (or the
 * whole project, for `stop-gate = "project"`), plus the layout comparison
 * with the session start. Files that mention a top-level package new this
 * session count as changed, since it can turn their old imports into
 * first-party ones (#86). Shape findings on files that predate the session
 * are legacy, like old violations. A baseline changed during the session
 * can't be trusted, so none is applied, and project mode falls back to the
 * changed files.
 *
 * @param deps - the platform and the check runner.
 * @param session - the real project root and the session id.
 * @param session.project - the real project root.
 * @param session.id - the session id, which names SessionStart's copies.
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
  { project, id }: { project: string; id: string },
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
  const lookups = createStartLookups({ ...io, check: deps.check }, { project, id });
  const fresh = newTopLevel(project, configs, {
    before: state.start.topLevel,
    now: projectTopLevel(io, project, configs),
  });
  const edits = changedFiles(io, lookups, state, manifest);
  // Not in `edits`, so byte for byte what they were at start: their own start content.
  const unchanged = freshImporters(io, project, fresh, manifest).filter((f) => !edits.includes(f));
  const changed = [...edits, ...unchanged];
  const checked = await checkChanged(
    lookups,
    changed,
    { start: state.start, now: configs, found, fresh, unchanged: new Set(unchanged) },
    edited.length === 0,
  );
  const texts = Object.fromEntries(
    Object.keys(configs).map((rel) => [rel, io.read.text(join(project, rel))]),
  );
  const layout = newLayoutErrors(
    project,
    { valid: configs, texts },
    { before: state.start.manifest, now: manifest },
    { before: state.start.links, now: projectLinks(io, project, configs), probe: io.probe },
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
 * Lists what makes the session untrustworthy regardless of the code: a start
 * record that doesn't hold up (`recordProblems`), a changed `[tool.inwards]`
 * or baseline, or Claude Code settings without the Inwards hooks.
 *
 * @param io - reads the Claude Code settings or the OpenCode plugin, knows
 *   which agent runs the hook, and runs git for the committed configs.
 * @param project - the real project root.
 * @param state - the session state.
 * @param now - the valid configs now, and the baselines that changed during the session.
 * @param now.configs - the valid configs now.
 * @param now.edited - baselines that changed during the session.
 * @returns the problems, one sentence each.
 */
function trustProblems(
  io: Pick<Platform, "read" | "runtime" | "probe" | "git">,
  project: string,
  state: SessionState,
  { configs, edited }: { configs: Record<string, InwardsConfig>; edited: readonly string[] },
): string[] {
  const problems = recordProblems(io, project, state);
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
  const hooks = hookProblem(io, project);
  if (hooks !== undefined) {
    problems.push(hooks);
  }
  return problems;
}

/**
 * Says what is wrong with the start record itself (#88). The agent's Bash
 * can delete `.inwards/state` and pipe a SessionStart into the hook, which
 * would record a new start from a loosened project. The witness outside the
 * project catches that: the replay, or a record deleted or rewritten, is
 * reported, and the witness is the start. A record without a witness (a
 * session from before #88, or a witness deleted too) is trusted only when its
 * configs are the ones committed at its start HEAD, so a user's own
 * uncommitted config edit made before a witnessed session never blocks.
 *
 * @param io - runs git for the committed configs.
 * @param project - the real project root.
 * @param state - the session state.
 * @returns the problems, one sentence each.
 */
function recordProblems(io: Pick<Platform, "git">, project: string, state: SessionState): string[] {
  const ask = "Tell the user, and ask them to review what this session changed.";
  const found: string[] = [];
  if (state.replayed) {
    found.push(
      `A SessionStart for this session arrived after it had started (piped into \`inwards hook\` by hand?), so Inwards kept the original start record. ${ask}`,
    );
  }
  if (state.record === "deleted" || state.record === "replaced") {
    const what = state.record === "deleted" ? "is missing from" : "was rewritten in";
    found.push(
      `This session's start record ${what} .inwards/state, so Inwards checked against the copy it keeps outside the project. ${ask}`,
    );
  }
  if (state.record === "unwitnessed") {
    const none = "Inwards has no copy of this session's start record outside the project";
    const { uncommitted, unverifiable } = uncommittedConfigs(io.git, project, state.start);
    if (unverifiable) {
      found.push(
        `${none}, and this git (older than 2.44) can't read the committed [tool.inwards] here without risking a fetch (a partial clone, or a git config Inwards couldn't read), so the record can't be checked. Upgrading git to 2.44 or newer, or a writable XDG_STATE_HOME so sessions keep a copy, clears this. ${ask}`,
      );
    } else if (uncommitted.length > 0) {
      found.push(
        `${none}, and [tool.inwards] in ${uncommitted.join(", ")} was not the committed one when the record was made, so the record can't be trusted. If the user changed it before the session, they can commit it and start a new session (the check compares with the commit the session started from). ${ask}`,
      );
    }
  }
  return found;
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
