/**
 * @file The check slice's public face (ADR-047): `inwards check` and `inwards
 * baseline`, plus what the other slices read from a check: config discovery,
 * the project snapshot, routing and running a check, the text overlay and
 * violation fingerprints. Re-exports only; no adapter.
 */
export { runCheck } from "./_check.ts";
export { commandConfig, findConfig } from "./_config-discovery.ts";
export { configListsDiagram, DIAGRAM_FILE } from "./_diagrams.ts";
export { fingerprint } from "./_fingerprint.ts";
export { linksUnder } from "./_links.ts";
export { overlayTexts } from "./_overlay.ts";
export { type CheckUnit, planCheck } from "./_routing.ts";
export { runPlan } from "./_runs.ts";
export {
  projectConfigs,
  projectLinks,
  projectManifest,
  projectPath,
  projectTopLevel,
} from "./_snapshot.ts";
export {
  BASELINE_FILE,
  baselineHashes,
  changedBaselines,
} from "./baseline/index.ts";
export { baselineCommand, checkCommand } from "./cli.ts";
