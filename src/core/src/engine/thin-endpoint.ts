/**
 * @file Runs INW012 `thin-endpoint` for the engine: decides whether a file
 * needs the rule at all and hands it the rule's options and the layers. The
 * rule (`rules/thin-endpoint/`) reads the file's tree, and only one that may
 * hold an endpoint, plus the module of a handler a registration in it names,
 * both through the run's shared trees; its findings join the file's others
 * before the suppression comments apply. No I/O: the caller supplies the
 * file and the run's trees.
 */
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../contracts/records.ts";
import type { ModuleTrees } from "../rules/shared/module-trees.ts";
import { checkThinEndpoints, type ThinEndpointRun } from "../rules/thin-endpoint/check.ts";
import { checkEncoding } from "../rules/unsupported-encoding/index.ts";

/**
 * Finds INW012's findings in a file, whatever layer it is in. Nothing is
 * parsed when the rule is off for the file's module, when the file's
 * encoding can hide code (INW000 reports it), or when its text mentions no
 * framework and no configured decorator.
 *
 * @param src - the source file, with normalised text.
 * @param config - the project's config: its rules table and layers.
 * @param project - the run's trees: the file's own, and the modules of handlers registered from another module.
 * @param run - gives INW012's state for the run, built when a file first needs it.
 * @returns the findings, before suppressions.
 */
export function thinEndpointFindings(
  src: SourceFile,
  config: InwardsConfig,
  project: ModuleTrees,
  run: () => ThinEndpointRun,
): Diagnostic[] {
  const { rules, layers } = config;
  if (ruleLevel("INW012", rules, src.module) === "off" || checkEncoding(src)) {
    return [];
  }
  return checkThinEndpoints(src, { run: run(), layers, project });
}
