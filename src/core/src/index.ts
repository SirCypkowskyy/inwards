/**
 * @file The public API of `@inwards/core`, the only module the adapters import.
 * It re-exports the engine, the config parser, the reporters and the records
 * they exchange. Everything else in core is internal and may move; `test/api.test.ts`
 * pins this list, so a change to it is deliberate.
 */
export { baselineKey, stableMessage } from "./baseline/accepted.ts";
export type { ContextSpec } from "./config/contexts.ts";
export { CONFIG_DEFAULTS } from "./config/defaults.ts";
export {
  type AgentSuppressions,
  declaresInwards,
  type InwardsConfig,
  inwardsTable,
  type LayerSpec,
  parseConfig,
} from "./config/parse.ts";
export { type RuleSettings, ruleLevel } from "./config/rule-settings.ts";
export type { NameRule, ShapeSpec } from "./config/shape.ts";
export { ConfigError } from "./config/toml.ts";
export type {
  CachedExtraction,
  Diagnostic,
  ExtractionCache,
  ExtractionIdentity,
  Fix,
  ImportRef,
  Severity,
  SourceFile,
  Span,
  Suppressed,
} from "./contracts/records.ts";
export { type Checked, Engine } from "./engine/engine.ts";
export type { ListDir, ListMembers } from "./lookup/directory-listing.ts";
export type { PathKind } from "./lookup/module-lookup.ts";
export type { ProjectFiles, ProjectIndex } from "./lookup/project-index.ts";
export { DOCS_BASE, VERSION } from "./meta/product.ts";
export { RULES } from "./meta/registry.ts";
export { moduleNameFor } from "./python/module-names.ts";
export { extractImports, type GrammarBinaries } from "./python/parser.ts";
export { type Format, type RenderOptions, type Report, render } from "./report/render.ts";
export { checkLayers } from "./rules/layer-dependency.ts";
export {
  checkRequired,
  checkSelectors,
  checkShape,
  membersFrom,
  packagesOf,
  probeMembers,
  rootPathOf,
} from "./rules/package-shape/shape.ts";
export { layerIndexOf } from "./rules/shared/layer-ownership.ts";
export { checkMoves, checkPrefixes } from "./rules/unassigned-module/layout.ts";
