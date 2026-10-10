/**
 * @file The MCP server's policy (`inwards mcp`, ADR-042): the three tools,
 * bound to one invocation's check, working directory, config reads and rule
 * pages, and run one at a time, as the language server runs its checks, so
 * two calls never share the kept parse at once. What each tool does is its
 * own module's; the protocol is `adapters/mcp-connection.ts`'s.
 */
import type { ProjectIo } from "../project/contracts.ts";
import { checkFiles } from "./check-files.ts";
import type {
  CheckFilesInput,
  ExplainRuleInput,
  McpCheck,
  McpTools,
  ToolAnswer,
  WhereInput,
} from "./contracts.ts";
import { explainRule, type RulePages } from "./explain-rule.ts";
import { whereShouldThisGo } from "./where.ts";

/** What the tools need. */
export interface ToolsDeps {
  /** Runs `inwards check` with texts laid over the disk. */
  check: McpCheck;
  /** The server's working directory: the project the client started it in. */
  cwd: string;
  /** Finds and reads configs, for `where_should_this_go`. */
  io: Pick<ProjectIo, "probe" | "read">;
  /** The rule pages, for `explain_rule`. */
  pages: RulePages;
}

/**
 * Makes the tools. Calls queue: each starts when the one before it has
 * finished, whether it answered or failed.
 *
 * @param deps - the check, the working directory, the config reads and the rule pages.
 * @returns the three tool handlers, queued behind each other.
 */
export function createTools(deps: ToolsDeps): McpTools {
  let tail: Promise<unknown> = Promise.resolve();
  /**
   * Runs one call after every call before it.
   *
   * @param run - the call.
   * @returns what the call returns.
   */
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = tail.then(run, run);
    tail = next.catch(() => undefined);
    return next;
  }
  return {
    checkFiles: (input: CheckFilesInput): Promise<ToolAnswer> =>
      serial(() => checkFiles(deps.check, deps.cwd, input)),
    explainRule: (input: ExplainRuleInput): Promise<ToolAnswer> =>
      Promise.resolve(explainRule(deps.pages, input)),
    whereShouldThisGo: (input: WhereInput): Promise<ToolAnswer> =>
      serial(() => whereShouldThisGo(deps, input)),
  };
}
