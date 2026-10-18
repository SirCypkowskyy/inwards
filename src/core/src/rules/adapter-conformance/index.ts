/**
 * @file The public face of the adapter-conformance rule. Everything outside the folder imports
 * this module, never the private `_*.ts` modules behind it.
 */
export { checkAdapterConformance } from "./_check.ts";
