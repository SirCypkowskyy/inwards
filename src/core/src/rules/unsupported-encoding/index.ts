/**
 * @file The public face of the unsupported-encoding rule. Everything outside the folder imports
 * this module, never the private `_check.ts` behind it.
 */
export { checkEncoding } from "./_check.ts";
