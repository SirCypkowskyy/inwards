/**
 * @file Runs the per-endpoint FAPI rules of #183, FAPI001 and FAPI002, over
 * one file's records, each only when `[tool.inwards.rules]` turns it on. The
 * engine (`engine/fastapi.ts`) builds the model and the project lookups once
 * per check and calls this for every checked file; nothing here reads a file.
 */
import { type RuleSettings, ruleLevel } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { RULES } from "../../meta/registry.ts";
import { checkEndpointMetadata } from "./endpoint-metadata.ts";
import type { FastApiProject } from "./project.ts";
import type { FastApiFile } from "./records.ts";
import { checkUndocumentedErrors } from "./undocumented-error-response.ts";

/**
 * Tells whether FAPI001 or FAPI002 reports, so the engine can skip them whole.
 *
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @returns true when either is on.
 */
export function endpointRulesOn(rules: RuleSettings | undefined): boolean {
  return ruleLevel("FAPI001", rules) !== "off" || ruleLevel("FAPI002", rules) !== "off";
}

/**
 * Checks one file's path operations against FAPI001 and FAPI002.
 *
 * @param src - the file, with normalised text.
 * @param file - its FastAPI records.
 * @param scope - this check's FastAPI lookups.
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @returns the findings, before suppressions and severities apply.
 */
export function checkEndpoints(
  src: SourceFile,
  file: FastApiFile,
  scope: FastApiProject,
  rules: RuleSettings | undefined,
): Diagnostic[] {
  if (file.operations.length === 0) {
    return [];
  }
  const options = rules?.options ?? {};
  return [
    ...(ruleLevel("FAPI001", rules) === "off"
      ? []
      : checkEndpointMetadata(src, file, scope, options[RULES.FAPI001.name])),
    ...(ruleLevel("FAPI002", rules) === "off"
      ? []
      : checkUndocumentedErrors(src, file, scope, options[RULES.FAPI002.name])),
  ];
}
