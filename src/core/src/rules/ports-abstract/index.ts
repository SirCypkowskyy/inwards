/**
 * @file The public face of the ports-abstract rule. Everything outside the folder imports
 * this module, never the private `_*.ts` modules behind it.
 */
export { checkPortsAbstract } from "./_check.ts";
