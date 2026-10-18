/**
 * @file The rules slice's public face (#341, ADR-047): the `inwards rules`
 * and `inwards rule` handlers `main.ts` dispatches to. The rule-page reader
 * is in `page/`, which `mcp/` imports directly, and the embedded pages in
 * `adapters/pages.ts` are never re-exported, so only the root loads them,
 * behind a dynamic `import()`.
 */
export { ruleCommand, rulesCommand } from "./cli.ts";
