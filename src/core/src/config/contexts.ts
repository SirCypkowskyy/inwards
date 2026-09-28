/**
 * @file `[[tool.inwards.contexts]]`: bounded contexts or slices, what each owns,
 * which of its modules other contexts may import (`public`), and which contexts
 * it may depend on (`depends-on`). This module parses and validates the table
 * and answers which context owns a module; the rules that judge imports
 * between contexts (INW002, INW003) build on it.
 *
 * Contexts sit beside layers, not inside them: the constraints add up, and
 * neither table assigns membership in the other. Entries are literal module
 * prefixes for now (glob selectors are #191), and the longest matching prefix
 * decides a module's one owning context, so declaration order never matters.
 */
import { ConfigError, isDottedName, isRecord, rejectUnknownKeys } from "./toml.ts";

/** One bounded context or slice, with every optional list filled in. */
export interface ContextSpec {
  /** Unique, case-sensitive name, used in messages and in `depends-on`. */
  name: string;
  /** Literal module prefixes the context owns, with their descendants. */
  modules: string[];
  /** Prefixes of its own modules that contexts depending on it may import. */
  public: string[];
  /** Contexts this one may import from directly: not transitive, not reverse. */
  dependsOn: string[];
}

/** Keys one `[[tool.inwards.contexts]]` entry understands. */
export const CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "name",
  "modules",
  "public",
  "depends-on",
]);

/**
 * Validates `[[tool.inwards.contexts]]`: each entry on its own, then the
 * relations between entries (unique names, prefixes no two contexts share,
 * `public` entries their context owns, `depends-on` names that exist).
 *
 * @param value - the raw `contexts` value, if any.
 * @returns `{ contexts }` when there is at least one context, else nothing:
 *   leaving the table out and writing `contexts = []` mean the same.
 * @throws {ConfigError} naming the indexed key of the first problem.
 */
export function parseContexts(value: unknown): { contexts?: ContextSpec[] } {
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(
      "tool.inwards.contexts must be an array of tables: write each one as [[tool.inwards.contexts]].",
    );
  }
  const contexts = value.map((entry: unknown, i) => {
    if (!isRecord(entry) || Array.isArray(entry)) {
      throw new ConfigError(`tool.inwards.contexts[${i}] must be a table.`);
    }
    return parseContext(entry, i);
  });
  rejectDuplicateNames(contexts);
  rejectSharedPrefixes(contexts);
  contexts.forEach((context, i) => {
    checkPublic(contexts, context, i);
    checkDependsOn(contexts, context, i);
  });
  return contexts.length === 0 ? {} : { contexts };
}

/**
 * Finds the context that owns a module: the one with the longest prefix that
 * equals the module or one of its ancestors.
 *
 * @param module - a dotted module name, e.g. `shop.orders.api`.
 * @param contexts - the parsed contexts.
 * @returns the owning context, or undefined when no context owns the module.
 */
export function contextOf(
  module: string,
  contexts: readonly ContextSpec[],
): ContextSpec | undefined {
  let best: ContextSpec | undefined;
  let bestLength = -1;
  for (const context of contexts) {
    for (const prefix of context.modules) {
      const matches = module === prefix || module.startsWith(`${prefix}.`);
      if (matches && prefix.length > bestLength) {
        best = context;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/**
 * Validates one entry on its own: its keys, name and lists.
 *
 * @param entry - the raw table.
 * @param i - its index, for messages.
 * @returns the entry with the optional lists filled in.
 * @throws {ConfigError} naming the bad key.
 */
function parseContext(entry: Record<string, unknown>, i: number): ContextSpec {
  const where = `tool.inwards.contexts[${i}]`;
  rejectUnknownKeys(entry, CONTEXT_KEYS, where);
  const { name } = entry;
  if (typeof name !== "string" || name.trim() === "") {
    throw new ConfigError(`${where}.name must be a non-blank string.`);
  }
  const modules = moduleList(entry["modules"], `${where}.modules`);
  if (modules === undefined || modules.length === 0) {
    throw new ConfigError(
      `${where}.modules must be a non-empty list of module names, such as ["shop.orders"].`,
    );
  }
  return {
    name,
    modules,
    public: moduleList(entry["public"], `${where}.public`) ?? [],
    dependsOn: nameList(entry["depends-on"], `${where}.depends-on`) ?? [],
  };
}

/**
 * Validates a list of literal module prefixes.
 *
 * @param value - the raw list, if any.
 * @param where - the key's dotted path.
 * @returns the prefixes, or undefined when the key is absent.
 * @throws {ConfigError} naming the first entry that isn't a dotted module name.
 */
function moduleList(value: unknown, where: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(`${where} must be a list of module names.`);
  }
  value.forEach((entry: unknown, k) => {
    if (!isDottedName(entry)) {
      const glob = typeof entry === "string" && entry.includes("*");
      throw new ConfigError(
        glob
          ? `${where}[${k}] must be a dotted module name such as "shop.orders": contexts take literal prefixes, not wildcards.`
          : `${where}[${k}] must be a dotted module name such as "shop.orders".`,
      );
    }
  });
  return value.filter(isDottedName);
}

/**
 * Validates `depends-on`: a list of context names, each given once.
 *
 * @param value - the raw list, if any.
 * @param where - the key's dotted path.
 * @returns the names, or undefined when the key is absent.
 * @throws {ConfigError} naming the first entry that isn't a non-blank string, or a repeated one.
 */
function nameList(value: unknown, where: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(`${where} must be a list of context names.`);
  }
  const names: string[] = [];
  value.forEach((entry: unknown, k) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new ConfigError(`${where}[${k}] must be a context name.`);
    }
    if (names.includes(entry)) {
      throw new ConfigError(`${where}[${k}] repeats "${entry}".`);
    }
    names.push(entry);
  });
  return names;
}

/**
 * Throws when two contexts share a name.
 *
 * @param contexts - the parsed contexts.
 * @throws {ConfigError} naming the second one's key.
 */
function rejectDuplicateNames(contexts: readonly ContextSpec[]): void {
  contexts.forEach((context, i) => {
    const first = contexts.findIndex((other) => other.name === context.name);
    if (first !== i) {
      throw new ConfigError(
        `tool.inwards.contexts[${i}].name: context "${context.name}" is already declared as tool.inwards.contexts[${first}].`,
      );
    }
  });
}

/**
 * Throws when two contexts list the same prefix: which one owns it would be a guess.
 * Nested prefixes are fine; the longer one wins (see `contextOf`).
 *
 * @param contexts - the parsed contexts.
 * @throws {ConfigError} naming the prefix and both contexts.
 */
function rejectSharedPrefixes(contexts: readonly ContextSpec[]): void {
  const owners = new Map<string, string>();
  contexts.forEach(({ name, modules }, i) => {
    modules.forEach((prefix, k) => {
      const owner = owners.get(prefix);
      if (owner !== undefined && owner !== name) {
        throw new ConfigError(
          `tool.inwards.contexts[${i}].modules[${k}]: "${prefix}" is in two contexts, "${owner}" and "${name}".`,
        );
      }
      owners.set(prefix, name);
    });
  });
}

/**
 * Throws when a `public` entry isn't owned by its own context, either because
 * it lies outside the context's prefixes or because another context owns it
 * more specifically.
 *
 * @param contexts - all parsed contexts, for ownership.
 * @param context - the context whose `public` list is checked.
 * @param i - its index, for messages.
 * @throws {ConfigError} naming the entry and its actual owner.
 */
function checkPublic(contexts: readonly ContextSpec[], context: ContextSpec, i: number): void {
  context.public.forEach((prefix, k) => {
    const owner = contextOf(prefix, contexts);
    if (owner !== context) {
      const actual = owner === undefined ? "no context owns it" : `context "${owner.name}" owns it`;
      throw new ConfigError(
        `tool.inwards.contexts[${i}].public[${k}]: "${prefix}" isn't part of context "${context.name}" (${actual}).`,
      );
    }
  });
}

/**
 * Throws when `depends-on` names the context itself or a context that doesn't exist.
 *
 * @param contexts - all parsed contexts, for the names.
 * @param context - the context whose `depends-on` list is checked.
 * @param i - its index, for messages.
 * @throws {ConfigError} naming the entry.
 */
function checkDependsOn(contexts: readonly ContextSpec[], context: ContextSpec, i: number): void {
  context.dependsOn.forEach((name, k) => {
    const where = `tool.inwards.contexts[${i}].depends-on[${k}]`;
    if (name === context.name) {
      throw new ConfigError(`${where}: context "${name}" can't depend on itself.`);
    }
    if (!contexts.some((other) => other.name === name)) {
      const known = contexts.map((other) => `"${other.name}"`).join(", ");
      throw new ConfigError(`${where}: no context is named "${name}". Contexts: ${known}.`);
    }
  });
}
