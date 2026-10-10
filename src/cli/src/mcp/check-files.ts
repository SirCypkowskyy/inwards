/**
 * @file The `check_files` tool: `inwards check` for an agent, over named paths,
 * the whole project, or Python source it hasn't written yet. Paths resolve
 * against the server's working directory, the checks route as
 * `inwards check` routes them, and the answer is the
 * `inwards/diagnostics@1` report, so an agent reads the same fields as from
 * `inwards check --format json`. The check itself is injected (`McpCheck`).
 */
import { ConfigError, render } from "@inwards/core";
import { isRecord } from "../json/guards.ts";
import { absoluteFrom, failure } from "./answers.ts";
import type { CheckFilesInput, McpCheck, ToolAnswer } from "./contracts.ts";

/** The files a check reads, and so the only ones whose text may be given. */
const PYTHON = /\.pyi?$/u;

/**
 * Reads a rendered JSON report back as an object, for structured content.
 *
 * @param json - the rendered report.
 * @returns the report as an object.
 */
function asObject(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  return isRecord(parsed) ? parsed : {};
}

/**
 * Runs `check_files`: the named paths and the given texts, or the whole
 * project when neither is given, as `inwards check` from the working directory.
 *
 * @param check - runs the check.
 * @param cwd - the server's working directory, which relative paths and the report's paths start from.
 * @param input - the tool's arguments.
 * @returns the `inwards/diagnostics@1` report as JSON text and as data, with
 *   any notes appended to the text; an error answer for a text that isn't
 *   Python or a broken config.
 * @throws when the check fails for a reason other than its config.
 */
export async function checkFiles(
  check: McpCheck,
  cwd: string,
  input: CheckFilesInput,
): Promise<ToolAnswer> {
  const texts = new Map<string, string>();
  for (const [path, text] of Object.entries(input.contents ?? {})) {
    if (!PYTHON.test(path)) {
      return failure(`contents takes Python files only (.py or .pyi): ${path} is not one.`);
    }
    texts.set(absoluteFrom(cwd, path), text);
  }
  const named = [...(input.paths ?? []).map((path) => absoluteFrom(cwd, path)), ...texts.keys()];
  const targets = named.length === 0 ? undefined : [...new Set(named)];
  try {
    const { report, notes } = await check(targets, texts);
    const json = render(report, "json", { pretty: false, maxDiagnostics: input.maxDiagnostics });
    return { text: [json, ...notes].join("\n"), data: asObject(json) };
  } catch (err) {
    if (err instanceof ConfigError) {
      return failure(`config error: ${err.message}`);
    }
    throw err;
  }
}
