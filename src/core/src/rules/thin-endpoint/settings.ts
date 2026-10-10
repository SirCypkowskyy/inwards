/**
 * @file INW012's options, `[tool.inwards.rules.thin-endpoint]`, read into
 * typed settings with the rule's defaults, and the fnmatch-style name
 * patterns its call, type and decorator lists use. `config/rule-options.ts`
 * has already checked every value, so this only narrows types and fills in
 * defaults; it never reports a bad value.
 */
import { type OptionValue, stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Framework } from "./frameworks.ts";

/** Calls an endpoint shouldn't make itself: HTTP clients, mail, cloud SDKs, caches, databases (Django's raw connection too), task queues. */
const DEFAULT_DENY_CALLS: readonly string[] = [
  "requests.*",
  "httpx.*",
  "aiohttp.*",
  "urllib.request.*",
  "smtplib.*",
  "boto3.*",
  "redis.*",
  "sqlalchemy.*",
  "psycopg*.*",
  "asyncpg.*",
  "celery.*",
  "django.db.connection.*",
];

/** Parameter types whose methods are database work: SQLAlchemy's and SQLModel's sessions. */
const DEFAULT_DENY_RECEIVER_TYPES: readonly string[] = [
  "sqlalchemy.orm.Session",
  "sqlalchemy.orm.session.Session",
  "sqlalchemy.ext.asyncio.AsyncSession",
  "sqlalchemy.ext.asyncio.session.AsyncSession",
  "sqlmodel.Session",
  "sqlmodel.ext.asyncio.session.AsyncSession",
];

/** The characters a regular expression would read as syntax, escaped when a pattern holds them. */
const REGEX_SYNTAX = /[.\\^$+()[\]{}|]/u;

/** Tells whether a qualified name matches one of a list of patterns. */
export type NameMatch = (qualified: string) => boolean;

/** INW012's settings, with defaults filled in. A threshold of `false` turns its signal off. */
export interface ThinSettings {
  readonly maxStatements: number | false;
  readonly maxBranches: number | false;
  readonly maxNesting: number | false;
  readonly allowLoops: boolean;
  readonly allowComprehensions: boolean;
  /** Calls by qualified name: `deny-calls` (or the default list) plus `extend-deny-calls`. */
  readonly denyCalls: NameMatch;
  /** Parameter types whose method calls count as direct I/O. */
  readonly denyReceiverTypes: NameMatch;
  /** Parameter names whose method calls count as direct I/O, whatever their type. */
  readonly denyReceiverParams: ReadonlySet<string>;
  /** Layer names or module entries the endpoint must call into; undefined when unset. */
  readonly delegateTo: readonly string[] | undefined;
  /** What marks an endpoint: the frameworks, and the configured decorators and base classes. */
  readonly recognise: Recognise;
}

/** What marks an endpoint in a file, from the options. */
export interface Recognise {
  /** Qualified decorator patterns that mark an endpoint, besides the frameworks' own. */
  readonly decorators: readonly string[];
  /** The frameworks whose recognisers may run; undefined for every one the file mentions. */
  readonly frameworks: readonly Framework[] | undefined;
  /** Qualified patterns of in-house view base classes. */
  readonly baseClasses: readonly string[];
  /** True when `modules` narrows the rule, which lets plain Django function views count. */
  readonly scoped: boolean;
}

/**
 * Turns one fnmatch pattern into a regular expression: `*` is any run of
 * characters (dots included, as in fnmatch), `?` any one character.
 *
 * @param pattern - a qualified name with wildcards, e.g. `psycopg*.*`.
 * @returns an anchored regular expression.
 */
function patternRegExp(pattern: string): RegExp {
  const source = [...pattern]
    .map((c) => {
      if (c === "*") {
        return ".*";
      }
      return c === "?" ? "." : c.replace(REGEX_SYNTAX, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`, "u");
}

/**
 * Builds a matcher for a list of name patterns.
 *
 * @param patterns - qualified names with fnmatch wildcards.
 * @returns a function that tells whether a qualified name matches any of them.
 */
export function nameMatcher(patterns: readonly string[]): NameMatch {
  const compiled = patterns.map(patternRegExp);
  return (qualified: string): boolean => compiled.some((re) => re.test(qualified));
}

/**
 * Reads a threshold: an integer, or `false` for off.
 *
 * @param raw - the options table, if any.
 * @param key - the TOML key.
 * @param fallback - the default.
 * @returns the integer limit, `false` when the signal is off, or the default when the key is absent.
 */
function threshold(raw: RuleOptions | undefined, key: string, fallback: number): number | false {
  const value = raw?.[key];
  return typeof value === "number" || value === false ? value : fallback;
}

/**
 * Reads a boolean option.
 *
 * @param raw - the options table, if any.
 * @param key - the TOML key.
 * @param fallback - the default.
 * @returns the value, or the default when the key is absent.
 */
function flag(raw: RuleOptions | undefined, key: string, fallback: boolean): boolean {
  const value = raw?.[key];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Narrows the parsed `frameworks` list, which the parser has already checked.
 *
 * @param value - the raw option.
 * @returns the frameworks, or undefined when the key is absent.
 */
function frameworkList(value: OptionValue | undefined): Framework[] | undefined {
  const names = stringList(value);
  return names?.filter(
    (name): name is Framework =>
      name === "fastapi" || name === "flask" || name === "litestar" || name === "django",
  );
}

/**
 * Reads `[tool.inwards.rules.thin-endpoint]` with INW012's defaults.
 *
 * @param raw - the parsed options table, if any.
 * @returns every setting, a default filling each absent key.
 */
export function thinSettings(raw: RuleOptions | undefined): ThinSettings {
  const deny = stringList(raw?.["deny-calls"]) ?? DEFAULT_DENY_CALLS;
  const extend = stringList(raw?.["extend-deny-calls"]) ?? [];
  const types = stringList(raw?.["deny-receiver-types"]) ?? DEFAULT_DENY_RECEIVER_TYPES;
  return {
    maxStatements: threshold(raw, "max-statements", 10),
    maxBranches: threshold(raw, "max-branches", 2),
    maxNesting: threshold(raw, "max-nesting", 2),
    allowLoops: flag(raw, "allow-loops", false),
    allowComprehensions: flag(raw, "allow-comprehensions", true),
    denyCalls: nameMatcher([...deny, ...extend]),
    denyReceiverTypes: nameMatcher(types),
    denyReceiverParams: new Set(stringList(raw?.["deny-receiver-params"]) ?? []),
    delegateTo: stringList(raw?.["delegate-to"]),
    recognise: {
      decorators: stringList(raw?.["decorators"]) ?? [],
      frameworks: frameworkList(raw?.["frameworks"]),
      baseClasses: stringList(raw?.["base-classes"]) ?? [],
      scoped: raw?.["modules"] !== undefined,
    },
  };
}
