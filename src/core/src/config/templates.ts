/**
 * @file `[tool.inwards.templates.<name>]`: one named description of a kind of
 * package, which layer, shape and context entries use with `template =
 * "<name>"` (#97, ADR-036). This module validates the templates and expands a
 * shape or context entry that names one into the keys a hand-written entry
 * would have; `parse.ts` expands a layer entry's roles into layers, and a
 * template's `rules` into `[tool.inwards.rules]` (`template-rules.ts`).
 *
 * Nothing after the parser knows templates exist: every rule sees what the
 * equivalent hand-written config would give it. Pure: no I/O.
 */
import type { Severity } from "../contracts/records.ts";
import { memberPatterns, strings } from "./shape.ts";
import { parseTemplateRules, type TemplateRules } from "./template-rules.ts";
import { ConfigError, isDottedName, isRecord, rejectUnknownKeys } from "./toml.ts";

/** One validated template. */
export interface TemplateSpec {
  /**
   * Role modules, innermost first. Each inner list is one rank: `models |
   * schemas` gives two independent siblings. A role is a dotted name relative
   * to the layer entry's modules.
   */
  roles?: string[][];
  /** Modules, relative to a context's prefixes, that other contexts may import (INW003). */
  public?: string[];
  /** Members a shaped package may hold. The roles' first segments are added to it. */
  allow?: string[];
  /** Members a shaped package must hold (INW008). */
  require?: string[];
  /** Members no shaped package may hold. */
  forbid?: string[];
  /** Severity of a member `allow` doesn't cover. */
  extra?: Severity;
  /** Project advice added to the INW007 fix steps. */
  hints?: string[];
  /** Opt-in rules each role turns on (`template-rules.ts`), by role, then by rule name. */
  rules?: TemplateRules;
}

/** Keys one `[tool.inwards.templates.<name>]` table understands. */
export const TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  "roles",
  "public",
  "allow",
  "require",
  "forbid",
  "extra",
  "hints",
  "rules",
]);

/** The shape keys a template can supply to a `[[tool.inwards.shape]]` entry. */
const SHAPE_KEYS = ["allow", "require", "forbid", "extra", "hints"] as const;

/**
 * Validates `[tool.inwards.templates]`: a table of named templates.
 *
 * @param value - the raw `templates` value, if any.
 * @returns the templates by name; empty when the key is absent.
 * @throws {ConfigError} naming the first bad template or key.
 */
export function parseTemplates(value: unknown): Map<string, TemplateSpec> {
  const templates = new Map<string, TemplateSpec>();
  if (value === undefined) {
    return templates;
  }
  if (!isRecord(value) || Array.isArray(value)) {
    throw new ConfigError(
      "tool.inwards.templates must be a table of templates: write each one as [tool.inwards.templates.<name>].",
    );
  }
  for (const [name, entry] of Object.entries(value)) {
    const where = `tool.inwards.templates.${name}`;
    if (name.trim() === "") {
      throw new ConfigError("tool.inwards.templates has a template with a blank name.");
    }
    if (!isRecord(entry) || Array.isArray(entry)) {
      throw new ConfigError(`${where} must be a table.`);
    }
    templates.set(name, parseTemplate(entry, where));
  }
  return templates;
}

/**
 * Finds the template an entry names with its `template` key.
 *
 * @param entry - a raw layer, shape or context entry.
 * @param templates - the parsed templates.
 * @param where - the entry's dotted path, for messages.
 * @returns the template, or undefined when the entry names none.
 * @throws {ConfigError} when `template` isn't a string or names no template.
 */
export function templateOf(
  entry: Record<string, unknown>,
  templates: ReadonlyMap<string, TemplateSpec>,
  where: string,
): TemplateSpec | undefined {
  const { template: name } = entry;
  if (name === undefined) {
    return undefined;
  }
  if (typeof name !== "string") {
    throw new ConfigError(`${where}.template must be the name of a template.`);
  }
  const found = templates.get(name);
  if (found === undefined) {
    const known = [...templates.keys()].map((n) => `"${n}"`).join(", ");
    throw new ConfigError(
      known === ""
        ? `${where}.template: no template is named "${name}", and none is declared. Add a [tool.inwards.templates.${name}] table.`
        : `${where}.template: no template is named "${name}". Templates: ${known}.`,
    );
  }
  return found;
}

/**
 * Expands the `template` key of every `[[tool.inwards.shape]]` entry into the
 * template's `allow`, `require`, `forbid`, `extra` and `hints`. A key the
 * entry sets itself wins over the template's.
 *
 * @param value - the raw `shape` value; anything but an array passes through for the shape parser to reject.
 * @param templates - the parsed templates.
 * @returns the entries as a hand-written config would spell them.
 * @throws {ConfigError} when an entry names no template.
 */
export function withShapeTemplates(
  value: unknown,
  templates: ReadonlyMap<string, TemplateSpec>,
): unknown {
  return expandEntries(value, templates, "shape", (own, template) => {
    const given: Record<string, unknown> = {};
    for (const key of SHAPE_KEYS) {
      if (template[key] !== undefined) {
        given[key] = template[key];
      }
    }
    return { ...given, ...own };
  });
}

/**
 * Expands the `template` key of every `[[tool.inwards.contexts]]` entry: the
 * template's `public` modules, under each of the context's prefixes, join the
 * entry's own `public` list.
 *
 * @param value - the raw `contexts` value; anything but an array passes through for the context parser to reject.
 * @param templates - the parsed templates.
 * @returns the entries as a hand-written config would spell them.
 * @throws {ConfigError} when an entry names no template, or one without `public`.
 */
export function withContextTemplates(
  value: unknown,
  templates: ReadonlyMap<string, TemplateSpec>,
): unknown {
  return expandEntries(value, templates, "contexts", (own, template, where) => {
    const relative = template.public;
    if (relative === undefined) {
      throw new ConfigError(
        `${where}.template: the template has no public list, so it can't say which modules of the context others may import.`,
      );
    }
    const modules = Array.isArray(own["modules"]) ? own["modules"].filter(isDottedName) : [];
    const mine: unknown[] = Array.isArray(own["public"]) ? own["public"] : [];
    const given = modules.flatMap((prefix) => relative.map((p) => `${prefix}.${p}`));
    const extra = given.filter((name, k) => !mine.includes(name) && given.indexOf(name) === k);
    // A malformed own `public` stays as written, so the context parser names it.
    return own["public"] === undefined || Array.isArray(own["public"])
      ? { ...own, public: [...mine, ...extra] }
      : own;
  });
}

/**
 * Rewrites every entry of an array of tables that names a template, and
 * drops its `template` key; other entries pass through untouched.
 *
 * @param value - the raw array; anything else passes through for its own parser to reject.
 * @param templates - the parsed templates.
 * @param key - `shape` or `contexts`, for messages.
 * @param expand - builds the hand-written entry from the entry's other keys and its template.
 * @returns the rewritten array.
 * @throws {ConfigError} when an entry names no template, or `expand` refuses it.
 */
function expandEntries(
  value: unknown,
  templates: ReadonlyMap<string, TemplateSpec>,
  key: string,
  expand: (own: Record<string, unknown>, template: TemplateSpec, where: string) => unknown,
): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((entry: unknown, i) => {
    const where = `tool.inwards.${key}[${i}]`;
    const template = isRecord(entry) ? templateOf(entry, templates, where) : undefined;
    if (!isRecord(entry) || template === undefined) {
      return entry;
    }
    const { template: _name, ...own } = entry;
    return expand(own, template, where);
  });
}

/**
 * Validates one template table.
 *
 * @param entry - the raw table.
 * @param where - its dotted path, for messages.
 * @returns the template, with the roles' members added to `allow`.
 * @throws {ConfigError} naming the bad key.
 */
function parseTemplate(entry: Record<string, unknown>, where: string): TemplateSpec {
  rejectUnknownKeys(entry, TEMPLATE_KEYS, where);
  const spec: TemplateSpec = {};
  if (entry["roles"] !== undefined) {
    spec.roles = parseRoles(entry["roles"], `${where}.roles`);
  }
  if (entry["public"] !== undefined) {
    spec.public = relativeNames(entry["public"], `${where}.public`);
  }
  for (const key of ["allow", "require", "forbid"] as const) {
    if (entry[key] !== undefined) {
      spec[key] = memberPatterns(entry[key], `${where}.${key}`);
    }
  }
  const { extra, hints } = entry;
  if (extra !== undefined) {
    if (extra !== "error" && extra !== "warning") {
      throw new ConfigError(`${where}.extra must be "error" or "warning".`);
    }
    spec.extra = extra;
  }
  if (hints !== undefined) {
    spec.hints = strings(hints, `${where}.hints`);
  }
  if (entry["rules"] !== undefined) {
    spec.rules = parseTemplateRules(entry["rules"], spec.roles, `${where}.rules`);
  }
  if (spec.allow !== undefined && spec.roles !== undefined) {
    const members = spec.roles.flat().map((role) => role.split(".")[0] ?? role);
    spec.allow = [...new Set([...spec.allow, ...members])];
  }
  return spec;
}

/**
 * Validates `roles`: a non-empty list of lines, innermost first, each a role
 * or independent siblings joined by `|`. No role may appear twice.
 *
 * @param value - the raw list.
 * @param where - the key's dotted path.
 * @returns one list of roles per rank.
 * @throws {ConfigError} naming the first bad or repeated role.
 */
function parseRoles(value: unknown, where: string): string[][] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError(
      `${where} must be a non-empty list of roles, innermost first, such as ["models | schemas", "service", "router"].`,
    );
  }
  const seen = new Set<string>();
  return value.map((line: unknown, k) => {
    const roles = typeof line === "string" ? line.split("|").map((role) => role.trim()) : [];
    const bad = roles.find((role) => !isDottedName(role));
    if (roles.length === 0 || bad !== undefined) {
      throw new ConfigError(
        `${where}[${k}] must be a module name relative to the layer, such as "service", or siblings such as "models | schemas".`,
      );
    }
    for (const role of roles) {
      if (seen.has(role)) {
        throw new ConfigError(`${where}[${k}]: role "${role}" is already listed.`);
      }
      seen.add(role);
    }
    return roles;
  });
}

/**
 * Validates a list of dotted module names relative to a context.
 *
 * @param value - the raw list.
 * @param where - the key's dotted path.
 * @returns the module names, as written.
 * @throws {ConfigError} naming the first entry that isn't a dotted name.
 */
function relativeNames(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${where} must be a list of module names.`);
  }
  value.forEach((name: unknown, k) => {
    if (!isDottedName(name)) {
      throw new ConfigError(
        `${where}[${k}] must be a module name relative to the context, such as "service".`,
      );
    }
  });
  return value.filter(isDottedName);
}
