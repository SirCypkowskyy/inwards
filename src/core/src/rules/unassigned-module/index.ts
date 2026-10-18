/**
 * @file The public face of the unassigned-module rule. Everything outside the folder imports
 * this module, never the private `_*.ts` modules behind it.
 */
export { checkUnassignedImports, indexEvidence, unassignedWarning } from "./_imports.ts";
export { checkMoves, checkNestedProjects, checkPrefixes } from "./_layout.ts";
export { checkLinks, type LayerLink } from "./_links.ts";
