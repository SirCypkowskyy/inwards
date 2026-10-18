/**
 * @file The public face of the async-blocking rule. Everything outside the folder imports
 * this module, never the private `_*.ts` modules behind it.
 */
export { AsyncBlockingRun, checkAsyncBlocking } from "./_check.ts";
