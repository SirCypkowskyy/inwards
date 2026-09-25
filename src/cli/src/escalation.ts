/**
 * Escalation: some violations need a human decision, and blocking forever only
 * teaches the agent to game the check. When the same violation survives
 * `escalate-after` attempts (default 3), the hooks stop blocking and tell the
 * agent to summarise it and ask the user:
 *
 * - PostToolUse: the run that reaches the limit exits 0 with that instruction
 *   as `additionalContext`. Not sticky: the next run with the violation blocks again.
 * - Stop: the last allowed block says to ask the user; the Stop after it lets
 *   the turn end, lists the unresolved violations for the user in a
 *   `systemMessage`, and records them. The next session's SessionStart hands
 *   that list to the model.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { Diagnostic } from "@inwards/core";
import { stateDir, statePath } from "./state-files.ts";

/** Attempts before escalating, when the config doesn't say. */
export const DEFAULT_ESCALATE_AFTER = 3;
const UNRESOLVED = "unresolved.json";

/**
 * Words the instruction that replaces a block once the limit is reached.
 *
 * @param attempts - how many attempts the violations survived.
 * @returns the instruction for the model, without the `inwards:` prefix.
 */
export function askUser(attempts: number): string {
  return `These violations survived ${attempts} attempt${attempts === 1 ? "" : "s"}. Stop editing to work around them. Summarise each one for the user (file, import, why it breaks the layer rule) and ask how to proceed; the fix may need a decision you shouldn't make alone.`;
}

/**
 * Lists violations one per line, for people.
 *
 * @param diagnostics - the violations.
 * @returns lines like `shop/domain/order.py:3 INW001 Layer "domain" imports ...`.
 */
function listViolations(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((d) => `- ${d.file}:${d.line} ${d.code} ${d.message}`).join("\n");
}

/**
 * Ends the turn after the last block: tells the user what is unresolved and
 * records it for the next session.
 *
 * @param project - the real project root.
 * @param problems - session problems that aren't diagnostics.
 * @param diagnostics - the violations still there.
 * @returns 0; the message goes to stdout as the Stop hook's `systemMessage`.
 */
export function yieldTurn(
  project: string,
  problems: readonly string[],
  diagnostics: readonly Diagnostic[],
): number {
  const lines = [...problems.map((p) => `- ${p}`), listViolations(diagnostics)].filter(Boolean);
  const summary = `Inwards: the turn ended with unresolved architecture problems:\n${lines.join("\n")}`;
  try {
    const dir = stateDir(project);
    const temp = join(dir, `.${UNRESOLVED}.${process.pid}.tmp`);
    writeFileSync(temp, JSON.stringify({ at: new Date().toISOString(), summary }), { flag: "wx" });
    renameSync(temp, join(dir, UNRESOLVED));
  } catch {
    // best effort: the user still sees the summary now
  }
  process.stdout.write(`${JSON.stringify({ systemMessage: summary })}\n`);
  return 0;
}

/**
 * Takes the unresolved list the previous session left, once.
 *
 * @param project - the real project root.
 * @returns the summary, or undefined when there is none.
 */
export function takeUnresolved(project: string): string | undefined {
  const path = join(statePath(project), UNRESOLVED);
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    rmSync(path, { force: true });
    return typeof value === "object" && value !== null && "summary" in value
      ? String(value.summary)
      : undefined;
  } catch {
    return undefined;
  }
}
