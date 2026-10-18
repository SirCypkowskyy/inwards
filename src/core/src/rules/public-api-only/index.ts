/**
 * @file The public face of the public-api-only rule. Everything outside the folder imports
 * this module, never the private `_check.ts` behind it.
 */
export { checkPublicApi } from "./_check.ts";
