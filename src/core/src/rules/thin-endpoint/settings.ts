/**
 * @file INW012's options, `[tool.inwards.rules.thin-endpoint]`, read into
 * typed settings with the rule's defaults, and the fnmatch-style name
 * patterns its call, type and decorator lists use. `config/rule-options.ts`
 * has already checked every value, so this only narrows types and fills in
 * defaults; it never reports a bad value.
 */
import { type OptionValue, stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import { type NameMatch, nameMatcher } from "../shared/name-patterns.ts";
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

/**
 * SQLAlchemy's loader options, which are never a denied call: they only tell
 * a statement what to load with its rows (`Select.options()`), and an
 * endpoint passes them to a repository to shape its response
 * (`get_by_id(id, options=(joinedload(Payout.account),))`). The #182 corpus
 * run found that call alone behind 6 of Polar's INW012 findings.
 */
const LOADER_OPTION =
  /^sqlalchemy\.orm\.(?:strategy_options\.)?(?:joinedload|selectinload|subqueryload|lazyload|immediateload|noload|raiseload|defaultload|contains_eager|selectin_polymorphic|load_only|defer|undefer|undefer_group|with_expression)$/u;

/** Parameter types whose methods are database work: SQLAlchemy's and SQLModel's sessions. */
const DEFAULT_DENY_RECEIVER_TYPES: readonly string[] = [
  "sqlalchemy.orm.Session",
  "sqlalchemy.orm.session.Session",
  "sqlalchemy.ext.asyncio.AsyncSession",
  "sqlalchemy.ext.asyncio.session.AsyncSession",
  "sqlmodel.Session",
  "sqlmodel.ext.asyncio.session.AsyncSession",
];

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
 * Wraps the configured call patterns so a SQLAlchemy loader option never matches.
 *
 * @param listed - matches `deny-calls` (or the default list) plus `extend-deny-calls`.
 * @returns a matcher that is false for `sqlalchemy.orm.joinedload` and the other loader options.
 */
function deniedCall(listed: NameMatch): NameMatch {
  return (qualified: string): boolean => !LOADER_OPTION.test(qualified) && listed(qualified);
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
    denyCalls: deniedCall(nameMatcher([...deny, ...extend])),
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
