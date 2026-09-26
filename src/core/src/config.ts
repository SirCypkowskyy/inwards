import { parse } from "smol-toml";
import { VERSION } from "./meta.ts";
import { parseRules, type RuleSettings } from "./rule-config.ts";
import { type NameRule, parseShapeKeys, type ShapeSpec } from "./shape-config.ts";
import { ConfigError, isRecord, rejectUnknownKeys } from "./toml.ts";

export interface LayerSpec {
  name: string;
  /** Module prefixes that belong to the layer. `shop.domain` matches `shop.domain.order`. */
  modules: string[];
  /** Libraries the layer may import (`allow-libraries`); set, any other third-party one is denied (INW005). */
  allowLibraries?: string[];
  /** Libraries the layer may not import (`deny-libraries`), stdlib included (INW005). */
  denyLibraries?: string[];
}

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
}

/** What the Stop gate checks, see `InwardsConfig.stopGate`. */
export type StopGate = "changed" | "project";
const STOP_GATES: readonly string[] = ["changed", "project"] satisfies StopGate[];

/** A pre-release suffix such as `-rc.1`: an rc of 0.1.0 counts as 0.1.0. */
const PRERELEASE = /-.*$/u;
/** A plain release version, `MAJOR.MINOR.PATCH`. */
const RELEASE = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u;

/** Keys `[tool.inwards]` understands; anything else is a typo or a newer feature. */
const TABLE_KEYS: ReadonlySet<string> = new Set([
  "root",
  "layers",
  "required-version",
  "ignore",
  "escalate-after",
  "run-log",
  "stop-gate",
  "shape",
  "names",
  "rules",
]);
const LAYER_KEYS: ReadonlySet<string> = new Set([
  "name",
  "modules",
  "allow-libraries",
  "deny-libraries",
]);

/** An import name: dotted Python identifiers, e.g. `http.client` (INW005 library lists). */
const DOTTED_NAME = /^[\p{XID_Start}_]\p{XID_Continue}*(?:\.[\p{XID_Start}_]\p{XID_Continue}*)*$/u;

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
 * prefixes, and no prefix may belong to two layers. Unknown keys are errors,
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
  const { root = ".", layers } = raw;
  if (typeof root !== "string") {
    throw new ConfigError("tool.inwards.root must be a string.");
  }
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new ConfigError("tool.inwards.layers must be a non-empty array.");
  }
  const seen = new Set<string>();
  const parsed = layers.map((layer: unknown, i) => parseLayer(layer, i, seen));
  rejectOverlaps(parsed);
  const config: InwardsConfig = {
    root: root.replaceAll("\\", "/"),
    layers: parsed,
    ...optionalKeys(raw),
    ...stopGateKey(raw["stop-gate"]),
    ...parseShapeKeys(raw),
    ...parseRules(raw["rules"]),
  };
  return config;
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
 * Validates `stop-gate`.
 *
 * @param value - the raw `stop-gate` value, if any.
 * @returns `{ stopGate }` when it is set, else nothing.
 * @throws {ConfigError} when it is neither "changed" nor "project".
 */
function stopGateKey(value: unknown): Pick<InwardsConfig, "stopGate"> {
  if (value === undefined) {
    return {};
  }
  if (!isStopGate(value)) {
    throw new ConfigError('tool.inwards.stop-gate must be "changed" or "project".');
  }
  return { stopGate: value };
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

/**
 * Validates one entry of `layers`.
 *
 * @param layer - the raw entry.
 * @param i - its index, for messages.
 * @param seen - layer names so far, updated in place.
 * @returns the layer.
 * @throws {ConfigError} for unknown keys, a missing or repeated name, or bad modules or libraries.
 */
function parseLayer(layer: unknown, i: number, seen: Set<string>): LayerSpec {
  if (isRecord(layer)) {
    rejectUnknownKeys(layer, LAYER_KEYS, `tool.inwards.layers[${i}]`);
  }
  const { name, modules } = isRecord(layer) ? layer : {};
  if (typeof name !== "string" || name === "") {
    throw new ConfigError(`tool.inwards.layers[${i}].name must be a non-empty string.`);
  }
  if (seen.has(name)) {
    throw new ConfigError(`Layer "${name}" is declared twice.`);
  }
  seen.add(name);
  if (!isModuleList(modules)) {
    throw new ConfigError(`tool.inwards.layers[${i}].modules must be a list of module names.`);
  }
  const allow = libraryList(layer, i, "allow-libraries");
  const deny = libraryList(layer, i, "deny-libraries");
  return {
    name,
    modules,
    ...(allow === undefined ? {} : { allowLibraries: allow }),
    ...(deny === undefined ? {} : { denyLibraries: deny }),
  };
}

/**
 * Validates a layer's `allow-libraries` or `deny-libraries` (INW005).
 *
 * @param layer - the raw layer entry.
 * @param i - its index, for messages.
 * @param key - which of the two keys to read.
 * @returns the module names, or undefined when the key is absent.
 * @throws {ConfigError} when the value isn't a list of dotted Python identifiers.
 */
function libraryList(layer: unknown, i: number, key: string): string[] | undefined {
  const value = isRecord(layer) ? layer[key] : undefined;
  const valid = isModuleList(value) && value.every((entry) => DOTTED_NAME.test(entry));
  if (value !== undefined && !valid) {
    throw new ConfigError(
      `tool.inwards.layers[${i}].${key} must be a list of import names such as "sqlalchemy" or "http.client": no globs, and no distribution names like "python-dateutil".`,
    );
  }
  return valid ? value : undefined;
}

/**
 * Throws when a prefix belongs to two layers: which one owns it would be a guess.
 *
 * @param layers - the parsed layers.
 * @throws {ConfigError} naming the prefix and both layers.
 */
function rejectOverlaps(layers: readonly LayerSpec[]): void {
  const owners = new Map<string, string>();
  for (const { name, modules } of layers) {
    for (const prefix of modules) {
      const owner = owners.get(prefix);
      if (owner !== undefined && owner !== name) {
        throw new ConfigError(`"${prefix}" is in two layers, "${owner}" and "${name}".`);
      }
      owners.set(prefix, name);
    }
  }
}

/**
 * Tells whether a layer's `modules` value is a list of module prefixes.
 * An empty list passes; an empty string inside it does not.
 *
 * @param value - the raw `modules` value of one layer.
 * @returns true when every entry is a non-empty string.
 */
function isModuleList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((m) => typeof m === "string" && m !== "");
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
