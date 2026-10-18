/**
 * @file The `hook/` slice's public face: the `inwards hook claude-code`
 * handler `main.ts` dispatches to. Re-exports only; the state files in
 * `adapters/` are never re-exported, so only the root wires them in. Other
 * slices read the Claude Code settings through `claude-code/index.ts` and the
 * shared shapes through `contracts.ts`.
 */
export { hookClaudeCode } from "./cli.ts";
