/**
 * @file The public face of the thin-endpoint rule. Everything outside the folder imports
 * this module, never the private `_*.ts` modules behind it.
 */
export { checkThinEndpoints, ThinEndpointRun } from "./_check.ts";
