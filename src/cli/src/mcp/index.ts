/**
 * @file The MCP server slice's public face (ADR-042, ADR-047): the
 * `inwards mcp` handler `main.ts` dispatches to, and `explainRule`, which
 * `inwards rules` shares with the `explain_rule` tool. The ports and the
 * `RulePages` type live in `contracts.ts`, which the root imports directly;
 * the MCP connection in `adapters/` is never re-exported, so only the root
 * loads it, behind a dynamic `import()`.
 */
export { explainRule } from "./_explain-rule.ts";
export { mcpCommand } from "./cli.ts";
