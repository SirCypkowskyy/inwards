/**
 * @file The public face of the orm-naming rule. Everything outside the folder imports
 * this module, never the private `_*.ts` modules behind it.
 */
export { checkOrmNaming, projectFindings } from "./_check.ts";
export type { Models } from "./_models.ts";
export { foldKey } from "./_schemes.ts";
