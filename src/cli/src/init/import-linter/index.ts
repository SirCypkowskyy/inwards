/**
 * @file The import-linter mini-domain's public face: the `inwards
 * import-config` handler, and the TOML helpers `diagram/` shares to render its
 * own table. Re-exports only; reading, converting and the layer mapping stay
 * private to the folder.
 */

export { array, placeLines, quoted } from "./_render.ts";
export { importConfigCommand } from "./cli.ts";
