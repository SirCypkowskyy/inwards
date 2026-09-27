/**
 * What every Claude Code hook handler shares: the dependencies it is given,
 * where the project is, and the one sentence every denial ends with. The
 * handlers (`session-start.ts`, `config-guard.ts`, `post-tool-use.ts`,
 * `stop-gate.ts`) take `HookDeps` from `commands/hook.ts`, which gets them
 * from `main.ts`; none of them reaches for the environment or the
 * filesystem on its own.
 */
import type { Platform, Runtime } from "../platform/contracts.ts";
import type { RunLog } from "../runlog/record.ts";
import type { CheckRunner } from "../session/contracts.ts";

/** Ends every denial. The agent eval (eval/evidence.ts) counts denials by it. */
export const ASK_USER = "If this really must change, stop and ask the user to do it.";

/** What a hook handler is given for one invocation. */
export interface HookDeps {
  /** Everything outside the process. */
  io: Platform;
  /** This invocation's run log, which the handlers note their checks in. */
  runlog: RunLog;
  /** Runs a check with `io` bound (`project/check.ts`). */
  check: CheckRunner;
}

/**
 * The project a hook works in: `CLAUDE_PROJECT_DIR`, else the process cwd
 * (Claude Code runs hooks in the project), resolved to its real path. Never
 * the payload's own `cwd`, which the agent controls.
 *
 * @param io - resolves real paths and knows the environment.
 * @param io.probe - resolves real paths.
 * @param io.runtime - `CLAUDE_PROJECT_DIR` and the cwd.
 * @returns the real project root, or undefined when it doesn't exist.
 */
export function hookProject(io: {
  probe: Pick<Platform["probe"], "realpath">;
  runtime: Pick<Runtime, "claudeProjectDir" | "cwd">;
}): string | undefined {
  return io.probe.realpath(io.runtime.claudeProjectDir ?? io.runtime.cwd);
}
