/**
 * @file `inwards server`: the language server over stdio (ADR-041), for any
 * editor with an LSP client. It builds the server's policy (`lsp/session.ts`)
 * around the connection and the warm check `main.ts` wires in, and returns
 * when the editor ends the session. `--stdio` is accepted and changes
 * nothing, since editors pass it by convention; stdio is the only transport.
 */
import { createLanguageServer } from "../lsp/session.ts";
import { print } from "../platform/print.ts";
import type { AppDeps } from "./deps.ts";

/**
 * Runs `inwards server`.
 *
 * @param deps - this invocation's dependencies.
 * @param args - the positionals after `server`: none.
 * @param usage - the CLI usage text, for a usage error.
 * @returns the exit code: 0 after the editor's `exit`, 2 for a usage error
 *   (written to stderr, never to the protocol's stdout).
 */
export async function serverCommand(deps: AppDeps, args: string[], usage: string): Promise<number> {
  const { io, lsp, toml } = deps;
  if (args.length > 0) {
    return print(io.streams, usage, 2);
  }
  return await lsp.serve((editor) => createLanguageServer({ editor, check: lsp.check, io, toml }));
}
