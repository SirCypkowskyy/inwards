/**
 * @file The SessionStart hook: at startup or /clear, record where the session
 * starts (HEAD, every `[tool.inwards]` table and a content-hash manifest of
 * the Python files) for the Stop gate and the config guard, and hand the
 * model what earlier sessions left unresolved. A resume or compact only logs
 * itself. It also warns the user when the Inwards Stop hook is gone from the
 * Claude Code settings (#88). Otherwise silent, since SessionStart output
 * goes to the model.
 */
import type { Platform } from "../platform/contracts.ts";
import { print } from "../platform/print.ts";
import { isSessionId, recordStart } from "../session/record.ts";
import { takeUnresolved } from "./escalation.ts";
import { hookProject } from "./protocol.ts";
import { stopHookProblem } from "./settings.ts";

/**
 * Records where a session starts (at startup or /clear): HEAD, every
 * `[tool.inwards]` table and a content-hash manifest of the Python files, for
 * the Stop gate and the config guard. A resume or compact only logs itself.
 * On a new session it also hands the model what earlier sessions left
 * unresolved (see `escalation.ts`). In a project with session state, on
 * Claude Code, a Stop hook deleted from the settings (by an agent's Bash,
 * which hot-reloads) is reported to the user in a `systemMessage` and to the
 * model, and so is a witness that couldn't be written (`recordStart`), which
 * never fails the hook. Otherwise it is silent, since SessionStart output
 * goes to the model.
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
    const noWitness = recordStart(io, project, id, source);
    const unresolved =
      source === "startup" || source === "clear" ? takeUnresolved(io, project) : undefined;
    const noStop =
      io.runtime.hookHost === "claude-code" && io.probe.exists(io.state.statePath(project))
        ? stopHookProblem(io, project)
        : undefined;
    const context = [
      ...(unresolved === undefined
        ? []
        : [`${unresolved}\nAsk the user how they want these handled before changing that code.`]),
      ...(noStop === undefined ? [] : [`Inwards: ${noStop} Tell the user.`]),
    ];
    const warnings = [noStop, noWitness].filter((w) => w !== undefined);
    if (context.length + warnings.length > 0) {
      io.streams.out(`${JSON.stringify(output(context, warnings))}\n`);
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

/**
 * Builds SessionStart's output: warnings for the user as a `systemMessage`,
 * context for the model as `additionalContext`, each left out when empty.
 *
 * @param context - paragraphs for the model.
 * @param warnings - sentences for the user.
 * @returns the hook output object.
 */
function output(context: readonly string[], warnings: readonly string[]): Record<string, unknown> {
  const systemMessage =
    warnings.length === 0 ? {} : { systemMessage: `Inwards: ${warnings.join(" ")}` };
  const additionalContext = context.join("\n\n");
  return context.length === 0
    ? systemMessage
    : {
        ...systemMessage,
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
      };
}
