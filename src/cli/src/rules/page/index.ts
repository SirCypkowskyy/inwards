/**
 * @file The rule-page reader's public face: `readRulePage` and the `RulePage`
 * it returns, which the `explain_rule` tool in `mcp/` shares with `inwards
 * rule`. It sits in its own folder so `mcp/` can import it without closing a
 * cycle through the slice's `index.ts`, which reaches `mcp/` for `explainRule`.
 */
export { type RulePage, readRulePage } from "./_read.ts";
