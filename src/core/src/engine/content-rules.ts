/**
 * @file Runs the per-file content rules for the engine: INW012
 * `thin-endpoint` (through `thin-endpoint.ts`) and INW013 `async-blocking`.
 * Each decides whether a file needs it at all and parses the file itself,
 * and only one whose text may hold a finding; their findings join the file's
 * others before the suppression comments apply. No I/O: the caller supplies
 * the file and the project index.
 */
import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../contracts/records.ts";
import type { ProjectIndex } from "../lookup/project-index.ts";
import { checkAsyncBlocking } from "../rules/async-blocking/check.ts";
import { checkEncoding } from "../rules/unsupported-encoding.ts";
import { thinEndpointFindings } from "./thin-endpoint.ts";

/**
 * Finds INW013's findings in a file, whatever layer it is in. Nothing is
 * parsed when the rule is off for the file's module, or when the file's
 * encoding can hide code (INW000 reports it).
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config, for its rules table.
 * @returns the findings, before suppressions.
 */
function asyncBlockingFindings(
  parser: Parser,
  src: SourceFile,
  config: InwardsConfig,
): Diagnostic[] {
  const { rules } = config;
  if (ruleLevel("INW013", rules, src.module) === "off" || checkEncoding(src)) {
    return [];
  }
  return checkAsyncBlocking(parser, src, rules?.options?.["async-blocking"]);
}

/**
 * Finds the content rules' findings in a file: INW012's, then INW013's.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config: its rules table and layers.
 * @param project - the project's module index, for INW012's handlers registered from another module.
 * @returns the findings, before suppressions.
 */
export function contentFindings(
  parser: Parser,
  src: SourceFile,
  config: InwardsConfig,
  project: ProjectIndex,
): Diagnostic[] {
  return [
    ...thinEndpointFindings(parser, src, config, project),
    ...asyncBlockingFindings(parser, src, config),
  ];
}
