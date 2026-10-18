/**
 * @file The public API of `@inwards/core`, the only module the adapters import.
 * It re-exports the engine, the config parser, the reporters and the records
 * they exchange. Everything else in core is internal and may move; `test/api.test.ts`
 * pins this list, so a change to it is deliberate.
 */
export { baselineKey, stableMessage } from "./baseline/index.ts";
export {
  type AgentSuppressions,
  CONFIG_DEFAULTS,
  ConfigError,
  type ContextSpec,
  checkRuleOptions,
  contextOf,
  declaresInwards,
  diagramBase,
  diagramMatches,
  type InwardsConfig,
  inwardsTable,
  type LayerSpec,
  libraryDenies,
  type NameRule,
  parseConfig,
  type RuleSettings,
  ruleLevel,
  type ShapeSpec,
} from "./config/index.ts";
export type {
  CachedExtraction,
  Diagnostic,
  DiagramDraft,
  DiagramSource,
  ExtractionAnswer,
  ExtractionBatch,
  ExtractionCache,
  ExtractionIdentity,
  ExtractionJob,
  Fix,
  ImportRef,
  Severity,
  SourceFile,
  Span,
  Suppressed,
  SuppressionComment,
} from "./contracts/records.ts";
export {
  type DiagramExport,
  type DiagramKind,
  type DiagramNotation,
  writeDiagram,
} from "./diagram/index.ts";
export { checkDiagrams, type DiagramInput, draftDiagrams } from "./engine/diagrams.ts";
export { type Checked, Engine } from "./engine/engine.ts";
export { createExtractionWorker } from "./engine/extraction.ts";
export type { ListDir, ListMembers } from "./lookup/directory-listing.ts";
export { type PathKind, topLevelModules } from "./lookup/module-lookup.ts";
export type { ProjectFiles, ProjectIndex } from "./lookup/project-index.ts";
export { DOCS_BASE, VERSION } from "./meta/product.ts";
export { RULES } from "./meta/registry.ts";
export { moduleNameFor } from "./python/module-names.ts";
export { extractImports, type GrammarBinaries } from "./python/parser.ts";
export { createTreeReuse, type TreeReuse } from "./python/reparse.ts";
export { type Format, type RenderOptions, type Report, render } from "./report/index.ts";
export { checkLayers } from "./rules/layer-dependency/index.ts";
export {
  checkRequired,
  checkSelectors,
  checkShape,
  membersFrom,
  packagesOf,
  probeMembers,
  rootPathOf,
} from "./rules/package-shape/index.ts";
export { layerIndexOf, layerPackages } from "./rules/shared/layer-ownership.ts";
export {
  checkLinks,
  checkMoves,
  checkNestedProjects,
  checkPrefixes,
  type LayerLink,
} from "./rules/unassigned-module/index.ts";
