/**
 * @file The public API of `@inwards/core` stays what adapters import (#176).
 * `index.ts` is the only entry point, so moving a module inside core must not
 * add, drop or rename an export. The runtime names are compared with a fixed
 * list, and the type exports are checked by the compiler: a missing one fails
 * typecheck before the test runs.
 */
import { expect, test } from "bun:test";
import type {
  AgentSuppressions,
  Checked,
  Diagnostic,
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

/** Every type `index.ts` exports; the tuple fails to compile when one goes missing. */
type PublicTypes = [
  AgentSuppressions,
  Checked,
  Diagnostic,
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
    "ConfigError",
    "DOCS_BASE",
    "Engine",
    "RULES",
    "VERSION",
    "baselineKey",
    "checkLayers",
    "checkMoves",
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
