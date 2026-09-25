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
  let doc: { tool?: { inwards?: unknown } };
  try {
    doc = parse(pyprojectText) as typeof doc;
  } catch (err) {
    throw new ConfigError(`pyproject.toml is not valid TOML: ${(err as Error).message}`);
  }
  const raw = doc.tool?.inwards;
  if (!raw || typeof raw !== "object") {
    throw new ConfigError("pyproject.toml has no [tool.inwards] table.");
  }
  const { root = ".", layers } = raw as { root?: unknown; layers?: unknown };
  if (typeof root !== "string") throw new ConfigError("tool.inwards.root must be a string.");
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new ConfigError("tool.inwards.layers must be a non-empty array.");
  }
  const seen = new Set<string>();
  const parsed = layers.map((layer, i): LayerSpec => {
    const { name, modules } = (layer ?? {}) as { name?: unknown; modules?: unknown };
    if (typeof name !== "string" || name === "") {
      throw new ConfigError(`tool.inwards.layers[${i}].name must be a non-empty string.`);
    }
    if (seen.has(name)) throw new ConfigError(`Layer "${name}" is declared twice.`);
    seen.add(name);
    if (!Array.isArray(modules) || !modules.every((m) => typeof m === "string" && m !== "")) {
      throw new ConfigError(`tool.inwards.layers[${i}].modules must be a list of module names.`);
    }
    return { name, modules };
  });
  return { root: root.replaceAll("\\", "/"), layers: parsed };
}
