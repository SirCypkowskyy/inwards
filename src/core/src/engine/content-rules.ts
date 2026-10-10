/**
 * @file Runs the per-file content rules for the engine: INW012
 * `thin-endpoint` (through `thin-endpoint.ts`), INW013 `async-blocking` and
 * INW014 `ports-abstract`.
 * Each decides whether a file needs it at all and parses the file itself,
 * and only one whose text may hold a finding; their findings join the file's
 * others before the suppression comments apply. INW012 and INW013 may read
 * another first-party module through the project index. No I/O: the caller supplies
 * the file and the project index.
 */
import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../contracts/records.ts";
import type { ProjectIndex } from "../lookup/project-index.ts";
import { checkAsyncBlocking } from "../rules/async-blocking/check.ts";
import { checkPortsAbstract } from "../rules/ports-abstract/check.ts";
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
 * @param project - the project's module index, for the sync helpers a hop leads to.
 * @returns the findings, before suppressions.
 */
function asyncBlockingFindings(
  parser: Parser,
  src: SourceFile,
  config: InwardsConfig,
  project: ProjectIndex,
): Diagnostic[] {
  const { rules } = config;
  if (ruleLevel("INW013", rules, src.module) === "off" || checkEncoding(src)) {
    return [];
  }
  return checkAsyncBlocking(parser, src, rules?.options?.["async-blocking"], project);
}

/**
 * Finds INW014's findings in a file. Nothing is parsed when the rule is off
 * for the file's module or the file's encoding can hide code; the rule
 * itself skips a module that isn't a port module.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config: its rules table, and its layers for the fix.
 * @returns the findings, before suppressions.
 */
function portsAbstractFindings(
  parser: Parser,
  src: SourceFile,
  config: InwardsConfig,
): Diagnostic[] {
  const { rules, layers } = config;
  if (ruleLevel("INW014", rules, src.module) === "off" || checkEncoding(src)) {
    return [];
  }
  return checkPortsAbstract(parser, src, { options: rules?.options?.["ports-abstract"], layers });
}

/**
 * Finds the content rules' findings in a file: INW012's, INW013's, then INW014's.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config: its rules table and layers.
 * @param project - the project's module index, for INW012's handlers registered from another module and INW013's helpers one hop away.
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
    ...asyncBlockingFindings(parser, src, config, project),
    ...portsAbstractFindings(parser, src, config),
  ];
}
