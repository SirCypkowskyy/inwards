/**
 * @file The meaning of every `[tool.inwards]` key a project leaves unset. The
 * parser leaves unset keys out of `InwardsConfig`; the engine and the adapters
 * fill them in from here, and the JSON Schema's `default` annotations are
 * tested against this object, so the three can't disagree.
 */

/** Defaults of the unset keys, by their `InwardsConfig` names (`shapeExtra` is `shape[].extra`). */
export const CONFIG_DEFAULTS: {
  readonly root: ".";
  readonly escalateAfter: 3;
  readonly runLog: false;
  readonly stopGate: "changed";
  readonly agentSuppressions: "deny";
  readonly shapeExtra: "error";
} = {
  root: ".",
  escalateAfter: 3,
  runLog: false,
  stopGate: "changed",
  agentSuppressions: "deny",
  shapeExtra: "error",
};
