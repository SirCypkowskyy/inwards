/**
 * @file The public face of the context-independence rule. Everything outside the folder imports
 * this module, never the private `_check.ts` behind it.
 */
export { checkContextDependencies } from "./_check.ts";
