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
}

/** A pre-release suffix such as `-rc.1`: an rc of 0.1.0 counts as 0.1.0. */
const PRERELEASE = /-.*$/u;
/** A plain release version, `MAJOR.MINOR.PATCH`. */
const RELEASE = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u;

export class ConfigError extends Error {
  override name = "ConfigError";
}

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
 * Reads `[tool.inwards]` from the text of a `pyproject.toml`.
 * Validates every field the engine relies on and throws a ConfigError that
 * names the bad key, so adapters can show the message as is.
 *
 * `root` defaults to `.` and has backslashes turned into slashes. Layer names
 * must be unique and non-empty; each layer needs a list of non-empty module
 * prefixes. The TOML parser's own error is kept as `cause`.
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
  const { root = ".", layers, "required-version": required } = raw;
  const requiredVersion = checkRequiredVersion(required);
  if (typeof root !== "string") {
    throw new ConfigError("tool.inwards.root must be a string.");
  }
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new ConfigError("tool.inwards.layers must be a non-empty array.");
  }
  const seen = new Set<string>();
  const parsed = layers.map((layer: unknown, i): LayerSpec => {
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
  });
  const config: InwardsConfig = { root: root.replaceAll("\\", "/"), layers: parsed };
  if (requiredVersion !== undefined) {
    config.requiredVersion = requiredVersion;
  }
  return config;
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
