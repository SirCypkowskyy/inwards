/**
 * @file The public face of the layer-dependency rule. Everything outside the folder imports
 * this module, never the private `_check.ts` behind it.
 */
export { checkLayers } from "./_check.ts";
