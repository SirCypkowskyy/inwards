/**
 * @file The public face of the private-module rule. Everything outside the folder imports
 * this module, never the private `_*.ts` modules behind it.
 */
export { checkPrivateModules } from "./_check.ts";
