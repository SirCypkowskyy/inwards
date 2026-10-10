/**
 * @file Runs INW016 `orm-naming` for the engine: the per-file name checks,
 * which `content-rules.ts` adds to each file's findings, and the one
 * project-wide finding for a project without a `MetaData` naming
 * convention, which only a whole-project run adds (`batch.ts`), as it does
 * the import cycles. Nothing is parsed while the rule is off, nor a file
 * whose encoding can hide code (INW000 reports it). No I/O: the caller
 * supplies the files.
 */
import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../contracts/records.ts";
import { checkOrmNaming, conventionFinding } from "../rules/orm-naming/check.ts";
import { checkEncoding } from "../rules/unsupported-encoding.ts";

/**
 * Tells whether INW016 checks a file: on for its module, and an encoding Inwards can read.
 *
 * @param src - the source file, with normalised text.
 * @param config - the project's config, for its rules table.
 * @returns true when the rule covers the file.
 */
function covers(src: SourceFile, config: InwardsConfig): boolean {
  return ruleLevel("INW016", config.rules, src.module) !== "off" && checkEncoding(src) === null;
}

/**
 * Finds INW016's per-file findings, whatever layer the file is in.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config, for its rules table.
 * @returns the findings, before suppressions.
 */
export function ormNamingFindings(
  parser: Parser,
  src: SourceFile,
  config: InwardsConfig,
): Diagnostic[] {
  return covers(src, config)
    ? checkOrmNaming(parser, src, config.rules?.options?.["orm-naming"])
    : [];
}

/**
 * Finds INW016's project-wide finding over a whole-project run's files: no
 * `MetaData(naming_convention=...)` among them, and a table in a file the
 * rule covers.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param files - every file of the run, with normalised text, in order.
 * @param config - the project's config, for its rules table.
 * @returns the finding, or none.
 */
export function ormConventionFindings(
  parser: Parser,
  files: readonly SourceFile[],
  config: InwardsConfig,
): Diagnostic[] {
  if (ruleLevel("INW016", config.rules) === "off") {
    return [];
  }
  const readable = files.filter((src) => checkEncoding(src) === null);
  return conventionFinding(parser, readable, config.rules?.options?.["orm-naming"], (src) =>
    covers(src, config),
  );
}
