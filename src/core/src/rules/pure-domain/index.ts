/**
 * @file The public face of the pure-domain rule. Everything outside the folder imports
 * this module, never the private `_check.ts` behind it.
 */
export { checkLibraries, coversModule, type LibraryInputs } from "./_check.ts";
