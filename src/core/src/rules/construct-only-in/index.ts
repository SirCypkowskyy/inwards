/**
 * @file The public face of the construct-only-in rule. Everything outside the folder imports
 * this module, never the private `_*.ts` modules behind it.
 */
export { checkConstructOnlyIn } from "./_check.ts";
