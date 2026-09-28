/**
 * @file Runs the FAPI rules that read a file's own functions and calls rather
 * than its path operations: FAPI006 (event handlers), each only when
 * `[tool.inwards.rules]` turns it on. A file is parsed only when the text
 * pre-filter of a rule that is on matches, and then once for all of them. The
 * engine (`engine/fastapi.ts`) calls this for every checked file; nothing here
 * reads a file.
 */
import { type RuleSettings, ruleLevel } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { checkLifespanEvents, mentionsEvents } from "./lifespan-events.ts";
import type { FastApiProject } from "./project.ts";

/** The rules this module runs, by code. */
const CODES: readonly string[] = ["FAPI006"];

/**
 * Tells whether FAPI006 reports, so the engine can skip them whole.
 *
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @returns true when any of them is on.
 */
export function codeRulesOn(rules: RuleSettings | undefined): boolean {
  return CODES.some((code) => ruleLevel(code, rules) !== "off");
}

/**
 * Checks the checked files against FAPI006.
 *
 * @param files - the checked files, with normalised text, INW000's refusals left out.
 * @param scope - this check's FastAPI lookups.
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @returns the findings, before suppressions and severities apply.
 */
export function checkCode(
  files: readonly SourceFile[],
  scope: FastApiProject,
  rules: RuleSettings | undefined,
): Diagnostic[] {
  return files.flatMap((src) => checkFile(src, scope, rules));
}

/**
 * Checks one file against FAPI006.
 *
 * @param src - the file, with normalised text.
 * @param scope - this check's FastAPI lookups.
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @returns the file's findings.
 */
function checkFile(
  src: SourceFile,
  scope: FastApiProject,
  rules: RuleSettings | undefined,
): Diagnostic[] {
  const events = ruleLevel("FAPI006", rules) !== "off" && mentionsEvents(src.text);
  if (!events) {
    return [];
  }
  const syntax = scope.model.syntaxOf(src);
  return [...(events ? checkLifespanEvents(src, syntax, scope.model.fileModel(src), scope) : [])];
}
