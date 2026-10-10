/**
 * @file `inwards mcp`: the MCP server over stdio (ADR-042), for agents with an
 * MCP client. It binds the tools' policy (`mcp/tools.ts`) to a check that is
 * `inwards check`'s own (`planCheck` routes from the working directory,
 * `runPlan` runs and merges, the warm check `main.ts` wires in reads), with an
 * agent's unsaved texts laid over the disk, and serves the tools until the
 * client closes stdin. Nothing is noted in the run log.
 */
import type { Report } from "@inwards/core";
import type { McpCheck, McpTools } from "../mcp/contracts.ts";
import { createTools } from "../mcp/tools.ts";
import type { Streams } from "../platform/contracts.ts";
import { print } from "../platform/print.ts";
import { overlayTexts } from "../project/overlay.ts";
import { planCheck } from "../project/routing.ts";
import { runPlan } from "./check-runs.ts";
import type { AppDeps } from "./deps.ts";

/**
 * Makes the check the tools run: `inwards check` from the working directory
 * over the targets, with the texts laid over the disk for routing, the check
 * and the report's paths. What the run writes to stderr (a config that
 * couldn't be checked among several) becomes notes for the answer.
 *
 * @param deps - the MCP server's platform and warm check, and the TOML parser.
 * @returns a check over targets and texts, with the run's notes.
 */
function mcpCheck(deps: Pick<AppDeps, "mcp" | "toml">): McpCheck {
  return async (
    targets: string[] | undefined,
    texts: ReadonlyMap<string, string>,
  ): Promise<{ report: Report; notes: string[] }> => {
    const notes: string[] = [];
    const streams: Streams = {
      ...deps.mcp.io.streams,
      err(text: string): void {
        notes.push(text.trimEnd());
      },
    };
    const io = overlayTexts({ ...deps.mcp.io, streams }, texts);
    const plan = planCheck({ ...io, toml: deps.toml }, io.runtime.cwd, targets);
    const { merged } = await runPlan({ io, check: deps.mcp.check }, plan, {
      cache: true,
      log: false,
      texts,
    });
    return { report: merged, notes };
  };
}

/**
 * Makes the tools `inwards mcp` serves, bound to this invocation's warm
 * check, working directory and rule pages.
 *
 * @param deps - this invocation's dependencies.
 * @returns the three tool handlers.
 */
export async function mcpTools(deps: Pick<AppDeps, "mcp" | "toml">): Promise<McpTools> {
  const { mcp } = deps;
  return createTools({
    check: mcpCheck(deps),
    cwd: mcp.io.runtime.cwd,
    io: mcp.io,
    pages: await mcp.pages(),
  });
}

/**
 * Runs `inwards mcp`.
 *
 * @param deps - this invocation's dependencies.
 * @param args - the positionals after `mcp`: none.
 * @param usage - the CLI usage text, for a usage error.
 * @returns the exit code: 0 once the client has closed stdin, 2 for a usage
 *   error (written to stderr, never to the protocol's stdout).
 */
export async function mcpCommand(deps: AppDeps, args: string[], usage: string): Promise<number> {
  if (args.length > 0) {
    return print(deps.io.streams, usage, 2);
  }
  return await deps.mcp.serve(await mcpTools(deps));
}
