/**
 * @file The public face of the dynamic-import rule. Everything outside the folder imports
 * this module, never the private `_*.ts` modules behind it.
 */
export { checkDynamicImports, extractDynamicImports, mentionsDynamicImport } from "./_imports.ts";
