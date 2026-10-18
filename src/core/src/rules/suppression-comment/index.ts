/**
 * @file The public face of the suppression-comment rule. Everything outside the folder imports
 * this module, never the private `_check.ts` behind it.
 */
export { commentsIn, mentionsSuppression, suppress } from "./_check.ts";
