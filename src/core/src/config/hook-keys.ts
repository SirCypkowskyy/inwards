/**
 * @file The two `[tool.inwards]` keys that only the Claude Code hooks read,
 * each one of a few words: `stop-gate` (what the Stop gate checks) and
 * `agent-suppressions` (whether the hooks honour a suppression the agent
 * added). `config/parse.ts` calls these validators.
 */
import { ConfigError } from "./toml.ts";

/** What the hooks do with a suppression the agent added, see `InwardsConfig.agentSuppressions`. */
export type AgentSuppressions = "deny" | "allow";
const AGENT_SUPPRESSIONS: readonly string[] = ["deny", "allow"] satisfies AgentSuppressions[];

/** What the Stop gate checks, see `InwardsConfig.stopGate`. */
export type StopGate = "changed" | "project";
const STOP_GATES: readonly string[] = ["changed", "project"] satisfies StopGate[];

/**
 * Validates `stop-gate`.
 *
 * @param value - the raw `stop-gate` value, if any.
 * @returns `{ stopGate }` when it is set, else nothing.
 * @throws {ConfigError} when it is neither "changed" nor "project".
 */
export function stopGateKey(value: unknown): { stopGate?: StopGate } {
  if (value === undefined) {
    return {};
  }
  if (!isStopGate(value)) {
    throw new ConfigError('tool.inwards.stop-gate must be "changed" or "project".');
  }
  return { stopGate: value };
}

/**
 * Validates `agent-suppressions`.
 *
 * @param value - the raw value, if any.
 * @returns `{ agentSuppressions }` when it is set, else nothing.
 * @throws {ConfigError} when it is neither "deny" nor "allow".
 */
export function agentSuppressionsKey(value: unknown): { agentSuppressions?: AgentSuppressions } {
  if (value === undefined) {
    return {};
  }
  if (!isAgentSuppressions(value)) {
    throw new ConfigError('tool.inwards.agent-suppressions must be "deny" or "allow".');
  }
  return { agentSuppressions: value };
}

/**
 * Tells whether a raw value is an `agent-suppressions` mode.
 *
 * @param value - the raw value.
 * @returns true for "deny" or "allow".
 */
function isAgentSuppressions(value: unknown): value is AgentSuppressions {
  return typeof value === "string" && AGENT_SUPPRESSIONS.includes(value);
}

/**
 * Tells whether a raw value is a Stop gate mode.
 *
 * @param value - the raw `stop-gate` value.
 * @returns true for "changed" or "project".
 */
function isStopGate(value: unknown): value is StopGate {
  return typeof value === "string" && STOP_GATES.includes(value);
}
