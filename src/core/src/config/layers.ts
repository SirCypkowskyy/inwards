/**
 * @file The `layers` array of `[tool.inwards]`: each entry validated, nested
 * arrays of independent siblings given a shared rank, and entries that name a
 * template expanded into one layer per role (#97, ADR-036). It owns
 * `LayerSpec`; `parse.ts` calls it and re-exports the type. No I/O.
 */
import { isSelector, selectorProblem } from "./layer-selector.ts";
import { type TemplateSpec, templateOf } from "./templates.ts";
import { ConfigError, isDottedName, isRecord, rejectUnknownKeys } from "./toml.ts";

export interface LayerSpec {
  name: string;
  /**
   * Module prefixes and selectors that belong to the layer. `shop.domain`
   * matches `shop.domain.order`; `shop.*.domain` matches
   * `shop.orders.domain.order` (ADR-034).
   */
  modules: string[];
  /** Libraries the layer may import (`allow-libraries`); set, any other third-party one is denied (INW005). */
  allowLibraries?: string[];
  /** Libraries the layer may not import (`deny-libraries`), stdlib included (INW005). */
  denyLibraries?: string[];
  /**
   * Libraries added to the layer's deny list (`extend-deny-libraries`): to
   * `deny-libraries` when set, else to the default list the innermost layer
   * gets, else to nothing (INW005).
   */
  extendDenyLibraries?: string[];
  /**
   * The layer's place in the order when some layers are independent siblings
   * (a nested array in `layers`, or `a | b` in a template's roles): layers of
   * one rank may not import each other, and a layer may import every layer of
   * a lower rank. Set on every layer when the config has siblings, and on none
   * otherwise; then a layer's rank is its index.
   */
  rank?: number;
}

export const LAYER_KEYS: ReadonlySet<string> = new Set([
  "name",
  "modules",
  "allow-libraries",
  "deny-libraries",
  "extend-deny-libraries",
  "template",
]);

/**
 * Validates `layers` and expands it: a nested array is a group of independent
 * siblings that share a rank, and an entry with a template becomes one layer
 * per role, named `<entry>.<role>` and owning `<module>.<role>` for each of
 * the entry's modules, with its library lists. The entry itself is no layer.
 *
 * @param layers - the raw, non-empty `layers` array.
 * @param templates - the parsed templates.
 * @returns the layers, innermost first; with ranks only when some layers are siblings.
 * @throws {ConfigError} naming the first bad entry, a template without roles, a repeated layer name, or an entry in two layers.
 */
export function parseLayers(
  layers: readonly unknown[],
  templates: ReadonlyMap<string, TemplateSpec>,
): LayerSpec[] {
  const groups: LayerSpec[][] = [];
  layers.forEach((entry: unknown, i) => {
    const where = `tool.inwards.layers[${i}]`;
    if (Array.isArray(entry)) {
      groups.push(siblings(entry, where));
      return;
    }
    const template = isRecord(entry) ? templateOf(entry, templates, where) : undefined;
    const layer = parseLayer(entry, where);
    groups.push(...(template === undefined ? [[layer]] : roleLayers(layer, template, where)));
  });
  const specs = groups.flat();
  const ranks = groups.flatMap((group, rank) => group.map(() => rank));
  const seen = new Set<string>();
  for (const { name } of specs) {
    if (seen.has(name)) {
      throw new ConfigError(`Layer "${name}" is declared twice.`);
    }
    seen.add(name);
  }
  rejectOverlaps(specs);
  return ranks.every((rank, k) => rank === k)
    ? specs
    : specs.map((layer, k) => ({ ...layer, rank: ranks[k] ?? k }));
}

/**
 * Validates a nested array of `layers`: two or more independent siblings.
 *
 * @param entry - the raw nested array.
 * @param where - its dotted path, for messages.
 * @returns the sibling layers.
 * @throws {ConfigError} for a group of fewer than two, a sibling with a template, or a bad sibling.
 */
function siblings(entry: readonly unknown[], where: string): LayerSpec[] {
  if (entry.length < 2) {
    throw new ConfigError(
      `${where} must be a single layer, or two or more independent sibling layers in a nested array.`,
    );
  }
  return entry.map((sibling: unknown, j) => {
    if (isRecord(sibling) && sibling["template"] !== undefined) {
      throw new ConfigError(
        `${where}[${j}].template: a layer with a template can't be a sibling; put it in layers on its own.`,
      );
    }
    return parseLayer(sibling, `${where}[${j}]`);
  });
}

/**
 * Expands a layer entry with a template into its role layers, one group per
 * rank of roles, innermost first.
 *
 * @param slot - the validated entry: its name, modules and library lists.
 * @param template - the template it names.
 * @param where - the entry's dotted path, for messages.
 * @returns the role layers, grouped by rank.
 * @throws {ConfigError} when the template has no roles or the entry no modules.
 */
function roleLayers(slot: LayerSpec, template: TemplateSpec, where: string): LayerSpec[][] {
  if (template.roles === undefined) {
    throw new ConfigError(
      `${where}.template: the template has no roles, so it can't expand into layers.`,
    );
  }
  if (slot.modules.length === 0) {
    throw new ConfigError(
      `${where}.modules must name at least one package to put the template's roles in.`,
    );
  }
  const { name, modules, ...libraries } = slot;
  return template.roles.map((group) =>
    group.map((role) => ({
      name: `${name}.${role}`,
      modules: modules.map((prefix) => `${prefix}.${role}`),
      ...libraries,
    })),
  );
}

/**
 * Validates one layer entry.
 *
 * @param layer - the raw entry.
 * @param where - its dotted path, such as `tool.inwards.layers[2]`, for messages.
 * @returns the validated layer, with its optional library lists.
 * @throws {ConfigError} for unknown keys, a missing name, a malformed selector, or bad modules or libraries.
 */
function parseLayer(layer: unknown, where: string): LayerSpec {
  if (isRecord(layer)) {
    rejectUnknownKeys(layer, LAYER_KEYS, where);
  }
  const { name, modules } = isRecord(layer) ? layer : {};
  if (typeof name !== "string" || name === "") {
    throw new ConfigError(`${where}.name must be a non-empty string.`);
  }
  if (!isModuleList(modules)) {
    throw new ConfigError(`${where}.modules must be a list of module names.`);
  }
  modules.forEach((entry, k) => {
    const problem = isSelector(entry) ? selectorProblem(entry) : undefined;
    if (problem !== undefined) {
      throw new ConfigError(
        `${where}.modules[${k}]: "${entry}" is not a valid selector: ${problem}. A selector's segments are package names, * (one segment) or ** (one or more), and it starts with a package name, such as "shop.*.domain".`,
      );
    }
  });
  const allow = libraryList(layer, where, "allow-libraries");
  const deny = libraryList(layer, where, "deny-libraries");
  const extend = libraryList(layer, where, "extend-deny-libraries");
  return {
    name,
    modules,
    ...(allow === undefined ? {} : { allowLibraries: allow }),
    ...(deny === undefined ? {} : { denyLibraries: deny }),
    ...(extend === undefined ? {} : { extendDenyLibraries: extend }),
  };
}

/**
 * Validates a layer's `allow-libraries`, `deny-libraries` or
 * `extend-deny-libraries` (INW005).
 *
 * @param layer - the raw layer entry.
 * @param where - its dotted path, for messages.
 * @param key - which of the three keys to read.
 * @returns the module names, or undefined when the key is absent.
 * @throws {ConfigError} when the value isn't a list of dotted Python identifiers.
 */
function libraryList(layer: unknown, where: string, key: string): string[] | undefined {
  const value = isRecord(layer) ? layer[key] : undefined;
  const valid = isModuleList(value) && value.every((entry) => isDottedName(entry));
  if (value !== undefined && !valid) {
    throw new ConfigError(
      `${where}.${key} must be a list of import names such as "sqlalchemy" or "http.client": no globs, and no distribution names like "python-dateutil".`,
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
export function isModuleList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((m) => typeof m === "string" && m !== "");
}
