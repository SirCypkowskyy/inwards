/**
 * @file Small pieces every MCP tool shares: resolving a path an agent passed
 * against the server's working directory, and wording a failed call so the
 * client marks it as an error the model can act on. Pure: the working
 * directory comes in as a value.
 */
import { isAbsolute, resolve } from "node:path";
import type { ToolAnswer } from "./contracts.ts";

/**
 * Turns a tool's path into an absolute one.
 *
 * @param cwd - the server's working directory.
 * @param path - absolute, or relative to `cwd`.
 * @returns the absolute path.
 */
export function absoluteFrom(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/**
 * Words a failed tool call, for the model.
 *
 * @param text - what went wrong and what to do.
 * @returns an error answer.
 */
export function failure(text: string): ToolAnswer {
  return { text, error: true };
}
