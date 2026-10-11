/**
 * @file The `init/` slice's public face (ADR-047): the handlers `main.ts`
 * dispatches to (`inwards init`, `context`, `diagram`, `import-diagram` and
 * `import-config`) and the style names the help text lists. Re-exports only;
 * the file writer and the picker in `adapters/` are never re-exported, so
 * only the root wires them in, and `@clack/prompts` stays in its own chunk.
 */

export { STYLE_NAMES } from "./_styles.ts";
export { contextCommand } from "./brief/index.ts";
export { initMain } from "./cli.ts";
export { diagramCommand, importDiagramCommand } from "./diagram/index.ts";
export { importConfigCommand } from "./import-linter/index.ts";
