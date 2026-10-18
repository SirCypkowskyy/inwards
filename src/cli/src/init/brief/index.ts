/**
 * @file The architecture brief's public face: the `inwards context` handler,
 * and the brief that `inwards init` and `--style auto` put in AGENTS.md.
 * Re-exports only; the brief's text and its opt-in rules part stay private.
 */

export { withBrief } from "./_brief.ts";
export { contextCommand } from "./cli.ts";
