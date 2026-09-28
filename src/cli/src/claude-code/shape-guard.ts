/**
 * @file The shape guard (PreToolUse, #96): a Write that would create a Python
 * file the package shape forbids (INW007) is denied before the file exists,
 * with the finding's message and fix as the reason, which saves the agent a
 * move-and-delete round trip through Bash.
 *
 * Only a Write to a `.py` or `.pyi` path that doesn't exist yet is checked,
 * with `checkShape` against the config PostToolUse would use. Each denial is
 * recorded like a PostToolUse edit with the same fingerprints, so it counts
 * toward `escalate-after`, and the denial that reaches the limit tells the
 * agent to ask the user. The guard fails open: an internal error lets the
 * Write through, since PostToolUse and the Stop gate check the file anyway.
 * Edits of existing files and files created through Bash are left to them.
 */
import { dirname, relative, resolve } from "node:path";
import { checkShape, type Diagnostic, moduleNameFor, parseConfig } from "@inwards/core";
import { isRecord } from "../json/guards.ts";
import { isInside, posix } from "../paths/lexical.ts";
import { findConfig } from "../project/config-discovery.ts";
import { projectPath } from "../project/snapshot.ts";
import { isSessionId, readSessionStart } from "../session/record.ts";
import { landingPath, lexicalPath } from "./edit-simulation.ts";
import { askUser } from "./escalation.ts";
import { escalationOf, rememberEdit, sessionConfig } from "./post-tool-use.ts";
import { type HookDeps, hookProject } from "./protocol.ts";

const PYTHON_FILE = /\.pyi?$/u;
/** The keys INW007 reads; a config that never spells them has no shape to check. */
const SHAPE_KEYS = /shape|names/u;

/**
 * Runs the shape guard for one PreToolUse payload and prints a denial when
 * the Write would create a file the shape forbids.
 *
 * @param deps - the platform and this invocation's run log.
 * @param input - the hook payload (`tool_name`, `tool_input`, `cwd`, `session_id`).
 * @returns true when it printed a denial.
 */
export function shapeGuard(
  deps: Pick<HookDeps, "io" | "runlog">,
  input: Record<string, unknown>,
): boolean {
  let reason: string | undefined;
  try {
    reason = denialOf(deps, input);
  } catch {
    return false; // fail open: PostToolUse and the Stop gate check the file anyway
  }
  if (reason === undefined) {
    return false;
  }
  const hookSpecificOutput = {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  };
  deps.io.streams.out(`${JSON.stringify({ hookSpecificOutput })}\n`);
  return true;
}

/**
 * Decides whether a tool call creates a Python file the shape forbids, and
 * records the denial for escalation and the run log.
 *
 * @param deps - the platform and this invocation's run log.
 * @param input - the hook payload.
 * @returns the denial's reason, or undefined to let the call through.
 * @throws when the config or the session can't be read (the caller fails open).
 */
function denialOf(
  deps: Pick<HookDeps, "io" | "runlog">,
  input: Record<string, unknown>,
): string | undefined {
  const { io } = deps;
  const toolInput = isRecord(input["tool_input"]) ? input["tool_input"] : {};
  const file = toolInput["file_path"];
  if (input["tool_name"] !== "Write" || typeof file !== "string" || !PYTHON_FILE.test(file)) {
    return undefined;
  }
  const project = hookProject(io);
  if (project === undefined) {
    return undefined;
  }
  const cwd = resolve(typeof input["cwd"] === "string" ? input["cwd"] : project);
  const target = lexicalPath(io.runtime.home, cwd, file);
  const real = landingPath({ probe: io.probe, home: io.runtime.home }, cwd, file);
  const existing = io.probe.exists(target) || io.probe.isLink(target) !== undefined;
  if (existing || real === undefined || !isInside(project, real)) {
    return undefined;
  }
  const configPath = findConfig(io, dirname(target), project);
  if (configPath === undefined) {
    return undefined;
  }
  const text = io.read.text(configPath);
  if (!SHAPE_KEYS.test(text)) {
    return undefined; // no shape or names rules: skip the parse, most projects pay nothing
  }
  const config = parseConfig(text);
  const root = resolve(dirname(configPath), config.root);
  if (!isInside(root, target)) {
    return undefined;
  }
  const source = { path: posix(relative(cwd, target)), text: "" };
  const errors = checkShape({ ...source, ...moduleNameFor(relative(root, target)) }, config).filter(
    (d) => d.severity === "error",
  );
  if (errors.length === 0 || !asPostToolUse(deps.io, { project, target, configPath }, input)) {
    return undefined;
  }
  const session = { project, id: input["session_id"] };
  const escalation = escalationOf(io, session, configPath, errors);
  rememberEdit(io, session, target, errors);
  deps.runlog.noteRun(project, [target], errors);
  const ask = escalation === undefined ? "" : `${askUser(escalation.limit)}\n`;
  return `inwards: ${ask}${source.path} was not created.\n${errors.map(finding).join("\n")}`;
}

/**
 * Tells whether PostToolUse would block these findings too, so the guard
 * never denies what the file's own check would let through: the session
 * must check the file with the same config (a config that appeared
 * mid-session is passed over there), and the file must be new to the
 * session (INW007 on a file from the session start is only context).
 * Without a start record there is nothing to compare, and PostToolUse
 * blocks, so this answers true.
 *
 * @param io - reads the session start and resolves paths.
 * @param where - the project, the file to create and the config found for it.
 * @param where.project - the real project root.
 * @param where.target - the file to create, absolute, as written.
 * @param where.configPath - the config found above it.
 * @param input - the hook payload, for `session_id`.
 * @returns true when the finding would block after the Write.
 */
function asPostToolUse(
  io: HookDeps["io"],
  where: { project: string; target: string; configPath: string },
  input: Record<string, unknown>,
): boolean {
  const id = input["session_id"];
  const start = isSessionId(id) ? readSessionStart(io, where.project, id) : undefined;
  if (start === undefined) {
    return true;
  }
  const known = sessionConfig(io, dirname(where.target), where.project, start);
  const rel = projectPath(io.probe, where.project, where.target);
  return known === where.configPath && start.manifest[rel] === undefined;
}

/**
 * Words one finding for the denial: the rule, the message, the fix.
 *
 * @param d - an INW007 error.
 * @returns e.g. `INW007 "helpers.py" is not an allowed member ... Move the code ...`.
 */
function finding(d: Diagnostic): string {
  return [`${d.code} ${d.message}`, d.fix.summary, ...d.fix.steps].join(" ");
}
