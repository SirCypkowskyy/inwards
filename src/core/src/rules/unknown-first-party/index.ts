/**
 * @file The public face of the unknown-first-party rule. Everything outside the folder imports
 * this module, never the private `_check.ts` behind it.
 */
export { checkUnknownImports } from "./_check.ts";
