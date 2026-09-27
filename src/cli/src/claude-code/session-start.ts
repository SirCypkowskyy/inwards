/**
 * @file The SessionStart hook: at startup or /clear, record where the session
 * starts (HEAD, every `[tool.inwards]` table and a content-hash manifest of
 * the Python files) for the Stop gate and the config guard, and hand the
 * model what earlier sessions left unresolved. A resume or compact only logs
 * itself. Otherwise silent, since SessionStart output goes to the model.
 */
import type { Platform } from "../platform/contracts.ts";
import { print } from "../platform/print.ts";
import { isSessionId, recordStart } from "../session/record.ts";
import { takeUnresolved } from "./escalation.ts";
import { hookProject } from "./protocol.ts";

/**
 * Records where a session starts (at startup or /clear): HEAD, every
 * `[tool.inwards]` table and a content-hash manifest of the Python files, for
 * the Stop gate and the config guard. A resume or compact only logs itself.
 * On a new session it also hands the model what earlier sessions left
 * unresolved (see `escalation.ts`); otherwise it is silent, since
 * SessionStart output goes to the model.
 *
 * @param io - everything outside the process: the project, git, the state, stdout.
 * @param input - the hook payload.
 * @returns 0, or 1 (shown to the user only) when the state can't be written.
 */
export function sessionStart(io: Platform, input: Record<string, unknown>): number {
  const project = hookProject(io);
  const id = input["session_id"];
  if (!(project && isSessionId(id))) {
    return 0;
  }
  // No source means the payload is not the host's usual one: treat it as a
  // resume, which can never create a start.
  const source = typeof input["source"] === "string" ? input["source"] : "resume";
  try {
    recordStart(io, project, id, source);
    const unresolved =
      source === "startup" || source === "clear" ? takeUnresolved(io, project) : undefined;
    if (unresolved !== undefined) {
      const additionalContext = `${unresolved}\nAsk the user how they want these handled before changing that code.`;
      const hookSpecificOutput = { hookEventName: "SessionStart", additionalContext };
      io.streams.out(`${JSON.stringify({ hookSpecificOutput })}\n`);
    }
    return 0;
  } catch (err) {
    return print(
      io.streams,
      `inwards hook: session state: ${err instanceof Error ? err.message : String(err)}`,
      1,
    );
  }
}
