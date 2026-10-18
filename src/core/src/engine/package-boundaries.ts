/**
 * @file Runs the rules that guard package boundaries on a file's imports,
 * for the engine: INW002 `context-independence`, INW003 `public-api-only`
 * and INW021 `private-module` (ADR-046). It decides their precedence: an
 * undeclared dependency is INW002's alone while INW002 is on, and an import
 * INW003 reports on a line gets no INW021 there unless INW003 is off for the
 * module. It also tells the engine when INW021 needs a file outside every
 * layer read. No I/O: the caller supplies the imports and the index.
 */
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../contracts/records.ts";
import type { ProjectIndex } from "../lookup/project-index.ts";
import { checkContextDependencies } from "../rules/context-independence/index.ts";
import { checkPrivateModules } from "../rules/private-module.ts";
import { checkPublicApi } from "../rules/public-api-only/index.ts";

/**
 * Tells whether INW021 reports in a file's module.
 *
 * @param config - the project's config, for its rules table.
 * @param src - the source file.
 * @returns true when the rule is on and its options leave the module in scope.
 */
export function privateOn(config: InwardsConfig, src: SourceFile): boolean {
  return ruleLevel("INW021", config.rules, src.module) !== "off";
}

/**
 * Applies INW002, INW003 and INW021 to a file's imports. With INW002 off,
 * INW003 still holds an undeclared dependency to the public modules.
 *
 * @param config - the project's config: its contexts and rules table.
 * @param file - the source file.
 * @param imports - its imports, static or readable dynamic ones.
 * @param project - the module index.
 * @returns the violations found.
 */
export function boundaryFindings(
  config: InwardsConfig,
  file: SourceFile,
  imports: readonly ImportRef[],
  project: ProjectIndex,
): Diagnostic[] {
  const { contexts = [], rules } = config;
  const defer = ruleLevel("INW002", rules) !== "off";
  const contextual = [
    ...checkContextDependencies(file, imports, contexts, project.ownerOf),
    ...checkPublicApi(file, imports, project, { contexts, defer }),
  ];
  if (!privateOn(config, file)) {
    return contextual;
  }
  const inw003 = ruleLevel("INW003", rules, file.module) !== "off";
  const lines = new Set(contextual.flatMap((d) => (inw003 && d.code === "INW003" ? [d.line] : [])));
  return [
    ...contextual,
    ...checkPrivateModules(file, imports, project.ownerOf, (ref) => lines.has(ref.line)),
  ];
}
