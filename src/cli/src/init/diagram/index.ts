/**
 * @file The diagram commands' public face: `inwards diagram` (config to
 * diagram) and `inwards import-diagram` (diagram to config). Re-exports only;
 * the TOML a read diagram becomes stays private to the folder.
 */
export { diagramCommand, importDiagramCommand } from "./cli.ts";
