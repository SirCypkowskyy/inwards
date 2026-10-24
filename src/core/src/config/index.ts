/**
 * @file The public face of the config/ slice. Everything outside the folder
 * imports this module, never a private `_x.ts` behind it.
 */
export {
  type ContextSpec,
  contextOf,
  isPublicModule,
  privateParentOf,
  publicHomes,
} from "./_contexts.ts";
export type { CycleMode } from "./_cycles.ts";
export { CONFIG_DEFAULTS } from "./_defaults.ts";
export { diagramBase, diagramMatches } from "./_diagrams.ts";
export { DEFAULT_GENERATED, isGenerated } from "./_generated.ts";
export type { AgentSuppressions } from "./_hook-keys.ts";
export {
  deepestMatch,
  entryReach,
  filledFrom,
  isSelector,
  matchEntry,
  selectorProblem,
  topPackageOf,
} from "./_layer-selector.ts";
export type { LayerSpec } from "./_layers.ts";
export { declaresInwards, type InwardsConfig, inwardsTable, parseConfig } from "./_parse.ts";
export { type LibraryDeny, libraryDenies, type OptionValue, stringList } from "./_rule-options.ts";
export {
  applyRules,
  checkRuleOptions,
  type RuleOptions,
  type RuleSettings,
  ruleLevel,
} from "./_rule-settings.ts";
export { memberMatches, type NameRule, type ShapeSpec, selects, shapeFor } from "./_shape.ts";
export {
  type ConfigFile,
  entrySpan,
  spanOf,
  type TemplateRole,
  templateRole,
} from "./_source-span.ts";
export { ConfigError, isDottedName } from "./_toml.ts";
