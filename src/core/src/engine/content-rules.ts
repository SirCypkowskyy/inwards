/**
 * @file Runs the per-file content rules for the engine: INW012
 * `thin-endpoint` (through `thin-endpoint.ts`), INW013 `async-blocking` and
 * INW015 `construct-only-in`. Each decides whether a file needs it at all
 * and parses the file itself, and only one whose text may hold a finding;
 * their findings join the file's others before the suppression comments
 * apply. All may read another first-party module through the project index.
 * It also decides that an outward import INW001 reports gets INW001 alone,
 * not INW015 as well. No I/O: the caller supplies the file and the project
 * index.
 */
import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../contracts/records.ts";
import type { ProjectIndex } from "../lookup/project-index.ts";
import { checkAsyncBlocking } from "../rules/async-blocking/check.ts";
import { checkConstructOnlyIn } from "../rules/construct-only-in/check.ts";
import { layerIndexOf, outwardImports } from "../rules/shared/layer-ownership.ts";
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
 * Finds INW015's findings in a file a layer owns; a module no layer owns,
 * such as a test or a script, builds adapters on purpose. Nothing is parsed
 * when the rule is off for the file's module or the file's encoding can hide
 * code (INW000 reports it). An import INW001 reports as outward gets INW001
 * alone, unless INW001 is off for the module.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config: its rules table and layers.
 * @param project - the project's module index, for the role modules and re-exports.
 * @returns the findings, before suppressions.
 */
function constructOnlyInFindings(
  parser: Parser,
  src: SourceFile,
  config: InwardsConfig,
  project: ProjectIndex,
): Diagnostic[] {
  const { rules, layers } = config;
  const off = ruleLevel("INW015", rules, src.module) === "off";
  if (off || layerIndexOf(src.module, layers) === -1 || checkEncoding(src)) {
    return [];
  }
  const inw001 = ruleLevel("INW001", rules, src.module) !== "off";
  /**
   * Tells whether INW001 reports an import, so INW015 leaves it alone.
   *
   * @param ref - an import of a role module.
   * @returns true when INW001 is on and the import points outward.
   */
  function deferred(ref: ImportRef): boolean {
    return inw001 && outwardImports(src, [ref], layers).length > 0;
  }
  const options = rules?.options?.["construct-only-in"];
  return checkConstructOnlyIn(parser, src, options, { project, deferred });
}

/**
 * Finds the content rules' findings in a file: INW012's, INW013's, then INW015's.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config: its rules table and layers.
 * @param project - the project's module index, for INW012's handlers registered from another module, INW013's helpers one hop away and INW015's role modules.
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
    ...constructOnlyInFindings(parser, src, config, project),
  ];
}
