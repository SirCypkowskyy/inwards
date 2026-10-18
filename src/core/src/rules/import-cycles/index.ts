/**
 * @file The public face of the import-cycles rule. Everything outside the folder imports
 * this module, never the private `_*.ts` modules behind it.
 */
export { cycleDiagnostic, type FileImports, fileEdges, findCycles, searches } from "./_cycles.ts";
