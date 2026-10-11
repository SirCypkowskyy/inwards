/**
 * @file The language server slice's public face (ADR-041, ADR-047): the
 * `inwards server` handler `main.ts` dispatches to. The ports live in
 * `contracts.ts`, which the root imports directly; the LSP connection in
 * `adapters/` is never re-exported, so only the root wires it in.
 */
export { serverCommand } from "./cli.ts";
