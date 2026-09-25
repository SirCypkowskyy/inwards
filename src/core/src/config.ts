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

/** Reads `[tool.inwards]` from the text of a `pyproject.toml`. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isModuleList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((m) => typeof m === "string" && m !== "");
}
