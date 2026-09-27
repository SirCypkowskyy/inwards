/**
 * Routes a Claude Code hook payload to the handler for its event:
 * SessionStart, PreToolUse (the config guard), PostToolUse and Stop (the
 * gate). Any other event passes with exit 0, so a hook installed for more
 * events than Inwards handles never blocks the agent.
 */
import { configGuard } from "./config-guard.ts";
import { postToolUse } from "./post-tool-use.ts";
import type { HookDeps } from "./protocol.ts";
import { sessionStart } from "./session-start.ts";
import { stopGate } from "./stop-gate.ts";

/**
 * Hands a hook payload to the handler for its event.
 *
 * @param deps - the platform, this invocation's run log and the check runner.
 * @param event - the payload's `hook_event_name`.
 * @param input - the hook payload.
 * @returns the handler's exit code; 0 for events Inwards doesn't handle.
 */
export async function dispatch(
  deps: HookDeps,
  event: unknown,
  input: Record<string, unknown>,
): Promise<number> {
  if (event === "SessionStart") {
    return sessionStart(deps.io, input);
  }
  if (event === "Stop") {
    return await stopGate(deps, input);
  }
  if (event === "PreToolUse") {
    return configGuard(deps.io, input);
  }
  return event === "PostToolUse" ? await postToolUse(deps, input) : 0;
}
