/**
 * @file Parses `[tool.inwards]` from pyproject.toml into an `InwardsConfig`: the
 * layers, `ignore`, `generated`, `namespace-packages`, the per-rule settings, shapes and names, and
 * the hook settings (`escalate-after`, `run-log`, `stop-gate`,
 * `agent-suppressions`). Unknown keys and wrong types throw `ConfigError`, so
 * a typo fails loudly instead of quietly turning a rule off.
 *
 * Templates (`templates.ts`) are expanded here, once, before anything else is
 * checked: `layers.ts` turns a layer entry with a template into its role
 * layers, the shape and context entries get the template's keys, and a
 * template's `rules` join `[tool.inwards.rules]`. The result holds no trace of
 * templates, so the rules never see them.
 */
import { parse } from "smol-toml";
import { VERSION } from "../meta/product.ts";
import { type ContextSpec, parseContexts } from "./contexts.ts";
import { type CycleMode, parseCycles } from "./cycles.ts";
import { CONFIG_DEFAULTS } from "./defaults.ts";
import { parseGenerated } from "./generated.ts";
import {
  type AgentSuppressions,
  agentSuppressionsKey,
  type StopGate,
  stopGateKey,
} from "./hook-keys.ts";
import { isModuleList, type LayerSpec, parseLayers } from "./layers.ts";
import { delegateProblem, stringList } from "./rule-options.ts";
import { parseRules, type RuleSettings } from "./rule-settings.ts";
import { type NameRule, parseShapeKeys, type ShapeSpec } from "./shape.ts";
import { templateUses, withTemplateRules } from "./template-rules.ts";
import { parseTemplates, withContextTemplates, withShapeTemplates } from "./templates.ts";
import { ConfigError, isDottedName, isRecord, rejectUnknownKeys } from "./toml.ts";

export interface InwardsConfig {
  /** Directory, relative to the config file, that module names are computed from. */
  root: string;
  /** Innermost first. A layer may import itself and anything listed before it. */
  layers: LayerSpec[];
  /**
   * Oldest Inwards allowed to check this project (`required-version`, set by
   * `inwards init`). An older binary, or a shim, fails with a config error
   * instead of checking with rules it may not know.
   */
  requiredVersion?: string;
  /**
   * Module names left out of the INW006 unassigned-package warning, such as
   * `tests` or `migrations`. An entry matches whole name segments anywhere in a
   * module name: `migrations` covers `shop.orders.migrations.0001_initial`.
   * Imports from a layer into them are still checked. Absent when not set.
   */
  ignore?: string[];
  /**
   * Modules a build step writes (`generated`), which INW010 treats as existing
   * when they aren't on disk, such as protoc's `*_pb2` or setuptools-scm's
   * `_version`. Each entry is a dotted name whose segments may use `*` and
   * `?`; it matches whole segments anywhere in a module name, like `ignore`. Absent when not set, and then INW010 uses `DEFAULT_GENERATED`;
   * a list, even an empty one, replaces that default.
   */
  generated?: string[];
  /**
   * Implicit namespace packages that installed distributions add to
   * (`namespace-packages`), such as `acme.platform` when `acme-platform-auth`
   * provides `acme/platform/auth/`. INW010 doesn't report a module directly
   * inside one that isn't under the config root; a missing module inside a
   * subpackage that is here is still reported. Absent when not set.
   */
  namespacePackages?: string[];
  /**
   * How many attempts at the same violation before the hooks stop blocking
   * and tell the agent to ask the user (`escalate-after`, default 3).
   */
  escalateAfter?: number;
  /** Write the opt-in run log `.inwards/runs.jsonl` (`run-log`, default off). */
  runLog?: boolean;
  /**
   * What the Claude Code Stop gate checks (`stop-gate`): `"changed"`, the
   * default, checks the files the session changed; `"project"` checks the
   * whole project against its baseline, so a violation in a file the session
   * never touched blocks too. Absent when not set.
   */
  stopGate?: StopGate;
  /** Package shapes, `[[tool.inwards.shape]]`, first match wins (INW007, INW008). */
  shape?: ShapeSpec[];
  /** Where member names may appear, `[[tool.inwards.names]]` (INW007). */
  names?: NameRule[];
  /** Which rules report and at what severity, `[tool.inwards.rules]`. Absent when not set. */
  rules?: RuleSettings;
  /**
   * Whether the Claude Code hooks honour an inline suppression the agent
   * added (`agent-suppressions`): `"deny"`, the default, treats a suppression
   * that wasn't in the file at session start as absent; `"allow"` honours
   * it. `inwards check` and the language server always honour suppressions.
   * Absent when not set.
   */
  agentSuppressions?: AgentSuppressions;
  /**
   * Bounded contexts or slices, `[[tool.inwards.contexts]]`: which modules each
   * owns, which of them other contexts may import, and which contexts it may
   * depend on (INW002, INW003). Absent when not set or empty.
   */
  contexts?: ContextSpec[];
  /** Which import cycles INW004 reports (`cycles`, see `cycles.ts`); absent when not set. */
  cycles?: CycleMode[];
}

/** A pre-release suffix such as `-rc.1`: an rc of 0.1.0 counts as 0.1.0. */
const PRERELEASE = /-.*$/u;
/** A plain release version, `MAJOR.MINOR.PATCH`. */
const RELEASE = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u;

/** Keys `[tool.inwards]` understands; anything else is a typo or a newer feature. */
export const TABLE_KEYS: ReadonlySet<string> = new Set([
  "root",
  "layers",
  "required-version",
  "ignore",
  "generated",
  "namespace-packages",
  "escalate-after",
  "run-log",
  "stop-gate",
  "shape",
  "names",
  "rules",
  "agent-suppressions",
  "contexts",
  "cycles",
  "templates",
]);

/** Any mention of the tool, used only when the TOML can't be parsed. */
const INWARDS_WORD = /\binwards\b/u;

/**
 * Tells whether a `pyproject.toml` is meant to configure Inwards.
 * Decided on the parsed TOML, so `[ tool.inwards ]` and `["tool"."inwards"]`
 * count, which a substring search would miss. A file that isn't valid TOML
 * counts when it mentions `inwards`, so its error is reported, not skipped.
 *
 * @param pyprojectText - the full text of the `pyproject.toml` file.
 * @returns true when the file has a `tool.inwards` table, or is broken TOML that mentions it.
 */
export function declaresInwards(pyprojectText: string): boolean {
  let doc: unknown;
  try {
    doc = parse(pyprojectText);
  } catch {
    return INWARDS_WORD.test(pyprojectText);
  }
  const tool = isRecord(doc) ? doc["tool"] : undefined;
  return isRecord(tool) && "inwards" in tool;
}

/**
 * Reads the raw `[tool.inwards]` table, unvalidated, so two versions of a file
 * can be compared: the config guard denies an edit that changes it.
 *
 * @param pyprojectText - the full text of a `pyproject.toml` file.
 * @returns the table as parsed, undefined when absent, null when the TOML is invalid.
 */
export function inwardsTable(pyprojectText: string): unknown {
  let doc: unknown;
  try {
    doc = parse(pyprojectText);
  } catch {
    return null;
  }
  const tool = isRecord(doc) ? doc["tool"] : undefined;
  return isRecord(tool) ? tool["inwards"] : undefined;
}

/**
 * Reads `[tool.inwards]` from the text of a `pyproject.toml`.
 * Validates every field the engine relies on and throws a ConfigError that
 * names the bad key, so adapters can show the message as is.
 *
 * `root` defaults to `.` and has backslashes turned into slashes. Layer names
 * must be unique and non-empty; each layer needs a list of non-empty module
 * prefixes or selectors, a selector must be well formed, and no entry may
 * belong to two layers. Templates are expanded first, so these checks see
 * the layers, shapes and contexts they produce. Unknown keys are errors,
 * since a mistyped key would silently change nothing. The TOML parser's own
 * error is kept as `cause`.
 *
 * @param pyprojectText - the full text of the `pyproject.toml` file.
 * @returns the validated configuration.
 * @throws {ConfigError} when the TOML is invalid or the table is missing or malformed.
 */
export function parseConfig(pyprojectText: string): InwardsConfig {
  let doc: unknown;
  try {
    doc = parse(pyprojectText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`pyproject.toml is not valid TOML: ${detail}`, { cause: err });
  }
  const tool = isRecord(doc) ? doc["tool"] : undefined;
  const raw = isRecord(tool) ? tool["inwards"] : undefined;
  if (!isRecord(raw)) {
    throw new ConfigError("pyproject.toml has no [tool.inwards] table.");
  }
  rejectUnknownKeys(raw, TABLE_KEYS, "tool.inwards");
  const { root = CONFIG_DEFAULTS.root, layers } = raw;
  if (typeof root !== "string") {
    throw new ConfigError("tool.inwards.root must be a string.");
  }
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new ConfigError("tool.inwards.layers must be a non-empty array.");
  }
  const templates = parseTemplates(raw["templates"]);
  const parsed = parseLayers(layers, templates);
  const config: InwardsConfig = {
    root: root.replaceAll("\\", "/"),
    layers: parsed,
    ...optionalKeys(raw),
    ...parseGenerated(raw["generated"]),
    ...namespacePackagesKey(raw["namespace-packages"]),
    ...stopGateKey(raw["stop-gate"]),
    ...parseShapeKeys({ ...raw, shape: withShapeTemplates(raw["shape"], templates) }),
    ...parseRules(withTemplateRules(raw["rules"], templates, templateUses(layers))),
    ...agentSuppressionsKey(raw["agent-suppressions"]),
    ...parseContexts(withContextTemplates(raw["contexts"], templates)),
    ...parseCycles(raw["cycles"]),
  };
  const delegates = stringList(config.rules?.options?.["thin-endpoint"]?.["delegate-to"]) ?? [];
  const problem = delegateProblem(delegates, new Set(parsed.map((layer) => layer.name)));
  if (problem !== undefined) {
    throw new ConfigError(problem);
  }
  const construct = config.rules?.options?.["construct-only-in"];
  if (construct !== undefined && construct["role"] === undefined) {
    throw new ConfigError(
      "tool.inwards.rules.construct-only-in.role must be set: the rule has nothing to check without it.",
    );
  }
  return config;
}

/**
 * Validates `namespace-packages`: dotted package names, no wildcards, since
 * each one opens a package to modules Inwards can't see.
 *
 * @param value - the raw `namespace-packages` value, if any.
 * @returns `{ namespacePackages }` when it is set, else nothing.
 * @throws {ConfigError} when it isn't a list of dotted names.
 */
function namespacePackagesKey(value: unknown): Pick<InwardsConfig, "namespacePackages"> {
  if (value === undefined) {
    return {};
  }
  if (!(isModuleList(value) && value.every((entry) => isDottedName(entry)))) {
    throw new ConfigError(
      'tool.inwards.namespace-packages must be a list of package names such as "acme.platform": no globs.',
    );
  }
  return { namespacePackages: value };
}

/**
 * Validates the optional keys of `[tool.inwards]`.
 *
 * @param raw - the parsed table.
 * @returns the keys that are set, under their config names.
 * @throws {ConfigError} naming the first bad key.
 */
function optionalKeys(
  raw: Record<string, unknown>,
): Pick<InwardsConfig, "requiredVersion" | "ignore" | "escalateAfter" | "runLog"> {
  const { "required-version": required, ignore, "escalate-after": escalateAfter } = raw;
  const runLog = raw["run-log"];
  if (runLog !== undefined && typeof runLog !== "boolean") {
    throw new ConfigError("tool.inwards.run-log must be true or false.");
  }
  const requiredVersion = checkRequiredVersion(required);
  if (ignore !== undefined && !isModuleList(ignore)) {
    throw new ConfigError("tool.inwards.ignore must be a list of module names.");
  }
  const whole = typeof escalateAfter === "number" && Number.isInteger(escalateAfter);
  if (escalateAfter !== undefined && !(whole && escalateAfter >= 1)) {
    throw new ConfigError("tool.inwards.escalate-after must be a whole number of at least 1.");
  }
  return {
    ...(requiredVersion === undefined ? {} : { requiredVersion }),
    ...(ignore === undefined ? {} : { ignore }),
    ...(typeof escalateAfter === "number" ? { escalateAfter } : {}),
    ...(runLog === undefined ? {} : { runLog }),
  };
}

/**
 * Validates `required-version` and checks this binary is new enough.
 *
 * @param required - the raw `required-version` value, if any.
 * @returns the version string, or undefined when the key is absent.
 * @throws {ConfigError} when it isn't `MAJOR.MINOR.PATCH`, or is newer than this Inwards.
 */
function checkRequiredVersion(required: unknown): string | undefined {
  if (required === undefined) {
    return undefined;
  }
  const want = typeof required === "string" ? versionParts(required) : undefined;
  if (typeof required !== "string" || want === undefined) {
    throw new ConfigError('tool.inwards.required-version must look like "1.2.3".');
  }
  const have = versionParts(VERSION.replace(PRERELEASE, "")) ?? [0, 0, 0];
  const older = have.findIndex((part, i) => part !== want[i]);
  if (older !== -1 && (have[older] ?? 0) < (want[older] ?? 0)) {
    throw new ConfigError(
      `This project requires Inwards ${required} or newer; this is ${VERSION}. Install the newer release.`,
    );
  }
  return required;
}

/**
 * Splits a release version into numbers.
 *
 * @param version - e.g. `0.1.2`.
 * @returns `[major, minor, patch]`, or undefined when it isn't a plain release.
 */
function versionParts(version: string): [number, number, number] | undefined {
  const groups = RELEASE.exec(version)?.groups;
  if (!groups) {
    return undefined;
  }
  return [Number(groups["major"]), Number(groups["minor"]), Number(groups["patch"])];
}
