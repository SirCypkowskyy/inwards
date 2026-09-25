import { parse } from "smol-toml";

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
}

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
  const { root = ".", layers } = raw;
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
  return { root: root.replaceAll("\\", "/"), layers: parsed };
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
