/**
 * @file The meaning of every `[tool.inwards]` key a project leaves unset. The
 * parser fills in `root` and each shape's `extra`; it leaves the other unset
 * keys out of `InwardsConfig`, and the code that reads them (the hooks, the
 * Stop gate, the run log) falls back to this object. The JSON Schema's
 * `default` annotations are compared with it in the schema tests.
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
