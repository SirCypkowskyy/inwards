/**
 * @file The public API of `@inwards/core` stays what adapters import (#176).
 * `index.ts` is the only entry point, so moving a module inside core must not
 * add, drop or rename an export. Every name `index.ts` exports, types
 * included, is compared with a fixed list; the runtime names are checked on
 * the loaded module too, and the compiler checks the types still resolve.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentSuppressions,
  CachedExtraction,
  Checked,
  ContextSpec,
  Diagnostic,
  ExtractionCache,
  ExtractionIdentity,
  Fix,
  Format,
  GrammarBinaries,
  ImportRef,
  InwardsConfig,
  LayerSpec,
  ListDir,
  ListMembers,
  NameRule,
  PathKind,
  ProjectFiles,
  ProjectIndex,
  RenderOptions,
  Report,
  RuleSettings,
  Severity,
  ShapeSpec,
  SourceFile,
  Span,
  Suppressed,
} from "../src/index.ts";

/** One `export { ... } from "..."` or `export type { ... } from "..."` statement. */
const REEXPORT = /export\s+(?:type\s+)?\{(?<names>[^}]*)\}\s*from\s*"[^"]+";/gu;
/** The leading `@file` comment. */
const LEADING_COMMENT = /^\/\*\*[\s\S]*?\*\//u;
/** A `type` keyword before a name inside the braces. */
const TYPE_PREFIX = /^type\s+/u;

/** Every type `index.ts` exports; the tuple fails to compile when one goes missing. */
type PublicTypes = [
  AgentSuppressions,
  CachedExtraction,
  Checked,
  ContextSpec,
  Diagnostic,
  ExtractionCache,
  ExtractionIdentity,
  Fix,
  Format,
  GrammarBinaries,
  ImportRef,
  InwardsConfig,
  LayerSpec,
  ListDir,
  ListMembers,
  NameRule,
  PathKind,
  ProjectFiles,
  ProjectIndex,
  RenderOptions,
  Report,
  RuleSettings,
  Severity,
  ShapeSpec,
  SourceFile,
  Span,
  Suppressed,
];

test("the runtime exports are unchanged", async () => {
  // A namespace import would be the natural spelling; Biome allows only this one.
  const core = await import("../src/index.ts");
  expect(Object.keys(core).sort()).toEqual([
    "CONFIG_DEFAULTS",
    "ConfigError",
    "DOCS_BASE",
    "Engine",
    "RULES",
    "VERSION",
    "baselineKey",
    "checkLayers",
    "checkMoves",
    "checkNestedProjects",
    "checkPrefixes",
    "checkRequired",
    "checkSelectors",
    "checkShape",
    "declaresInwards",
    "extractImports",
    "inwardsTable",
    "layerIndexOf",
    "membersFrom",
    "moduleNameFor",
    "packagesOf",
    "parseConfig",
    "probeMembers",
    "render",
    "rootPathOf",
    "ruleLevel",
    "stableMessage",
  ]);
});

test("the type exports compile", () => {
  const none: PublicTypes | undefined = undefined;
  expect(none).toBeUndefined();
});

test("index.ts re-exports exactly these names, types included", () => {
  const text = readFileSync(join(import.meta.dir, "../src/index.ts"), "utf8").replace(
    LEADING_COMMENT,
    "",
  );
  // index.ts holds re-exports only, so nothing can be exported another way.
  expect(text.replace(REEXPORT, "").trim()).toBe("");
  const names = [...text.matchAll(REEXPORT)]
    .flatMap((m) => (m.groups?.["names"] ?? "").split(","))
    .map((name) => name.trim().replace(TYPE_PREFIX, ""))
    .filter(Boolean)
    .sort();
  expect(names).toEqual(
    [
      "AgentSuppressions",
      "CachedExtraction",
      "Checked",
      "CONFIG_DEFAULTS",
      "ConfigError",
      "ContextSpec",
      "DOCS_BASE",
      "Diagnostic",
      "Engine",
      "ExtractionCache",
      "ExtractionIdentity",
      "Fix",
      "Format",
      "GrammarBinaries",
      "ImportRef",
      "InwardsConfig",
      "LayerSpec",
      "ListDir",
      "ListMembers",
      "NameRule",
      "PathKind",
      "ProjectFiles",
      "ProjectIndex",
      "RULES",
      "RenderOptions",
      "Report",
      "RuleSettings",
      "Severity",
      "ShapeSpec",
      "SourceFile",
      "Span",
      "Suppressed",
      "SuppressionComment",
      "VERSION",
      "baselineKey",
      "checkLayers",
      "checkMoves",
      "checkNestedProjects",
      "checkPrefixes",
      "checkRequired",
      "checkSelectors",
      "checkShape",
      "declaresInwards",
      "extractImports",
      "inwardsTable",
      "layerIndexOf",
      "membersFrom",
      "moduleNameFor",
      "packagesOf",
      "parseConfig",
      "probeMembers",
      "render",
      "rootPathOf",
      "ruleLevel",
      "stableMessage",
    ].sort(),
  );
});
