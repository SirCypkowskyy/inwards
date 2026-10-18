/**
 * @file The public face of the diagram-missing-dependency rule. Everything outside the folder imports
 * this module, never the private `_*.ts` modules behind it.
 */
export { missingDependencies } from "./_check.ts";
