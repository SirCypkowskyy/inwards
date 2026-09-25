import { parse } from "smol-toml";
import { VERSION } from "./meta.ts";

export interface LayerSpec {
  name: string;
  /** Module prefixes that belong to the layer. `shop.domain` matches `shop.domain.order`. */
  modules: string[];
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
}

/** A pre-release suffix such as `-rc.1`: an rc of 0.1.0 counts as 0.1.0. */
const PRERELEASE = /-.*$/u;
/** A plain release version, `MAJOR.MINOR.PATCH`. */
const RELEASE = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u;

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Keys `[tool.inwards]` understands; anything else is a typo or a newer feature. */
const TABLE_KEYS: ReadonlySet<string> = new Set([
  "root",
  "layers",
  "required-version",
  "ignore",
  "escalate-after",
  "run-log",
]);
const LAYER_KEYS: ReadonlySet<string> = new Set(["name", "modules"]);

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
 * Tells whether a parsed value is a table (or array) whose keys can be read.
 * Used to walk untrusted TOML without casts.
 *
 * @param value - any value from the parsed document.
 * @returns true when the value is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates one entry of `layers`.
 *
 * @param layer - the raw entry.
 * @param i - its index, for messages.
 * @param seen - layer names so far, updated in place.
 * @returns the layer.
 * @throws {ConfigError} for unknown keys, a missing or repeated name, or bad modules.
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
  return { name, modules };
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
 * Throws on the first key a table isn't allowed to have.
 *
 * @param table - a parsed TOML table.
 * @param known - the keys it may have.
 * @param where - the table's dotted path, for the message.
 * @throws {ConfigError} naming the unknown key and the known ones.
 */
function rejectUnknownKeys(
  table: Record<string, unknown>,
  known: ReadonlySet<string>,
  where: string,
): void {
  const unknown = Object.keys(table).find((key) => !known.has(key));
  if (unknown !== undefined) {
    throw new ConfigError(`Unknown key ${where}.${unknown}. Known keys: ${[...known].join(", ")}.`);
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
