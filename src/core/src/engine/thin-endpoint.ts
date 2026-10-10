/**
 * @file Runs INW012 `thin-endpoint` for the engine: decides whether a file
 * needs the rule at all and hands it the rule's options and the layers. The
 * rule (`rules/thin-endpoint/`) parses the file itself, and only one that
 * may hold an endpoint; its findings join the file's others before the
 * suppression comments apply. No I/O: the caller supplies the file.
 */
import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../contracts/records.ts";
import { checkThinEndpoints } from "../rules/thin-endpoint/check.ts";
import { checkEncoding } from "../rules/unsupported-encoding.ts";

/**
 * Finds INW012's findings in a file, whatever layer it is in. Nothing is
 * parsed when the rule is off for the file's module, when the file's
 * encoding can hide code (INW000 reports it), or when its text mentions no
 * framework and no configured decorator.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config: its rules table and layers.
 * @returns the findings, before suppressions.
 */
export function thinEndpointFindings(
  parser: Parser,
  src: SourceFile,
  config: InwardsConfig,
): Diagnostic[] {
  const { rules, layers } = config;
  if (ruleLevel("INW012", rules, src.module) === "off" || checkEncoding(src)) {
    return [];
  }
  const options = rules?.options?.["thin-endpoint"];
  return checkThinEndpoints(parser, src, { options, layers });
}
