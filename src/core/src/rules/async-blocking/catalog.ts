/**
 * @file What INW013 treats as blocking: families of synchronous clients
 * (SQLAlchemy's `Session` and `Engine`, redis-py, boto3, the DB-API drivers)
 * and the configured extras, each with the names whose instances block, the
 * names whose call itself blocks, the methods that do I/O, and the words its
 * finding and fix use. Plain data and matching; it reads no syntax.
 *
 * Which `Session` methods block follows SQLAlchemy's own split:
 * `AsyncSession` makes awaitable exactly the methods that may emit SQL
 * (`execute`, `get`, `flush`, `commit`, `delete`, `merge`, `refresh` and the
 * rest) and keeps `add`, `expunge` and `in_transaction` plain. The sync-only
 * `query` and `bulk_*` methods, and SQLModel's `exec`, join them.
 */
import { type NameMatch, nameMatcher } from "../shared/name-patterns.ts";

/** One kind of blocking client, and how INW013 words a finding about it. */
export interface Family {
  /** Tells whether a qualified name is a type or factory whose instances' methods block. */
  readonly isType: NameMatch;
  /** Tells whether a qualified name is a callable whose call blocks by itself. */
  readonly isCall: NameMatch;
  /** Tells whether calling a method of an instance does I/O. */
  readonly blocks: (method: string) => boolean;
  /**
   * Words a method call: `talks to the database through a synchronous SQLAlchemy \`Session\``.
   *
   * @param type - the qualified name the receiver came from.
   */
  readonly method: (type: string) => string;
  /**
   * Words a blocking call of its own: `opens a synchronous database connection`.
   *
   * @param callee - the call's qualified name.
   */
  readonly call: (callee: string) => string;
  /** What the event loop waits for: `the database answers`. */
  readonly waits: string;
  /**
   * The async replacement, for the fix: `` `AsyncSession` from `sqlalchemy.ext.asyncio` ``.
   *
   * @param type - the qualified name the receiver or call came from.
   */
  readonly instead: (type: string) => string;
}

/**
 * Makes a matcher for an exact set of qualified names.
 *
 * @param names - the qualified names it accepts, no wildcards.
 * @returns a function that tells whether a name is one of them.
 */
function exact(names: readonly string[]): NameMatch {
  const set = new Set(names);
  return (qualified: string): boolean => set.has(qualified);
}

/**
 * Matches nothing: a family whose calls never block by themselves.
 *
 * @returns false.
 */
function never(): boolean {
  return false;
}

/** A boto3 resource's sub-resource factory, such as `Bucket`: capitalised, built locally. */
const SUB_RESOURCE = /^[A-Z]/u;

/** The `Session` methods `AsyncSession` awaits, plus the sync-only ones that run SQL. */
const SESSION_IO: ReadonlySet<string> = new Set([
  "close",
  "commit",
  "connection",
  "delete",
  "execute",
  "exec",
  "flush",
  "get",
  "get_one",
  "invalidate",
  "merge",
  "refresh",
  "reset",
  "rollback",
  "scalar",
  "scalars",
  "query",
  "bulk_save_objects",
  "bulk_insert_mappings",
  "bulk_update_mappings",
]);

/** `Engine` and `Connection` methods that only set options. */
const ENGINE_QUIET: ReadonlySet<string> = new Set(["execution_options", "get_execution_options"]);

/** redis-py methods that build an object and send nothing until it runs. */
const REDIS_QUIET: ReadonlySet<string> = new Set(["pipeline", "pubsub", "lock"]);

/** boto3 client methods that sign or build locally. */
const BOTO3_QUIET: ReadonlySet<string> = new Set([
  "generate_presigned_url",
  "generate_presigned_post",
  "get_paginator",
  "get_waiter",
  "can_paginate",
]);

/** The DB-API drivers' connect functions: each opens a connection when called. */
const DRIVER_CONNECTS: readonly string[] = [
  "sqlite3.connect",
  "psycopg2.connect",
  "psycopg.connect",
  "psycopg.Connection.connect",
  "pymysql.connect",
  "MySQLdb.connect",
  "mysql.connector.connect",
];

/** The words every database family shares. */
const DATABASE = "the database answers";

/** The built-in families. */
export const FAMILIES: readonly Family[] = [
  {
    isType: exact([
      "sqlalchemy.orm.Session",
      "sqlalchemy.orm.session.Session",
      "sqlalchemy.orm.scoped_session",
      "sqlalchemy.orm.scoping.scoped_session",
      "sqlmodel.Session",
      "sqlmodel.orm.session.Session",
    ]),
    isCall: never,
    blocks: (method: string): boolean => SESSION_IO.has(method),
    method: (): string => "talks to the database through a synchronous SQLAlchemy `Session`",
    call: (): string => "",
    waits: DATABASE,
    instead: (): string => "`AsyncSession` from `sqlalchemy.ext.asyncio`",
  },
  {
    isType: exact([
      "sqlalchemy.create_engine",
      "sqlalchemy.engine.create_engine",
      "sqlmodel.create_engine",
      "sqlalchemy.Engine",
      "sqlalchemy.engine.Engine",
      "sqlalchemy.engine.base.Engine",
      "sqlalchemy.Connection",
      "sqlalchemy.engine.Connection",
      "sqlalchemy.engine.base.Connection",
    ]),
    isCall: never,
    blocks: (method: string): boolean => !ENGINE_QUIET.has(method),
    method: (): string =>
      "talks to the database through a synchronous SQLAlchemy `Engine` or `Connection`",
    call: (): string => "",
    waits: DATABASE,
    instead: (): string => "`create_async_engine` from `sqlalchemy.ext.asyncio`",
  },
  {
    isType: exact([
      "redis.Redis",
      "redis.StrictRedis",
      "redis.client.Redis",
      "redis.client.StrictRedis",
      "redis.from_url",
      "redis.Redis.from_url",
      "redis.StrictRedis.from_url",
      "redis.client.Redis.from_url",
      "redis.RedisCluster",
      "redis.cluster.RedisCluster",
    ]),
    isCall: never,
    blocks: (method: string): boolean => !REDIS_QUIET.has(method),
    method: (): string => "sends a command through a synchronous Redis client",
    call: (): string => "",
    waits: "Redis answers",
    instead: (): string => "`redis.asyncio.Redis`",
  },
  {
    isType: exact(["boto3.client", "boto3.resource"]),
    isCall: never,
    // A capitalised method of a resource (`s3.Bucket("b")`) builds a sub-resource locally.
    blocks: (method: string): boolean => !(BOTO3_QUIET.has(method) || SUB_RESOURCE.test(method)),
    method: (): string => "calls AWS through a synchronous boto3 client",
    call: (): string => "",
    waits: "AWS answers",
    instead: (): string => "an async AWS client (`aioboto3` or `aiobotocore`)",
  },
  {
    isType: exact([
      ...DRIVER_CONNECTS,
      "sqlite3.Connection",
      "psycopg.Connection",
      "psycopg2.extensions.connection",
      "pymysql.connections.Connection",
      "MySQLdb.connections.Connection",
    ]),
    isCall: exact(DRIVER_CONNECTS),
    blocks: (): boolean => true,
    method: (type: string): string => `uses a synchronous database connection (\`${type}\`)`,
    call: (): string => "opens a synchronous database connection",
    waits: DATABASE,
    instead: (): string =>
      "an async driver (`asyncpg`, `psycopg.AsyncConnection`, `aiosqlite` or `aiomysql`)",
  },
];

/** The top-level packages the built-in families come from, for the text prefilter. */
export const LIBRARIES: readonly string[] = [
  "sqlalchemy",
  "sqlmodel",
  "redis",
  "boto3",
  "sqlite3",
  "psycopg",
  "pymysql",
  "MySQLdb",
  "mysql",
];

/**
 * Builds the family for `extend-blocking-calls` and `extend-blocking-types`.
 *
 * @param calls - qualified-name patterns of calls that block.
 * @param types - qualified-name patterns of types whose every method blocks.
 * @returns a family whose finding says which option marked the call.
 */
export function configuredFamily(calls: readonly string[], types: readonly string[]): Family {
  return {
    isType: nameMatcher(types),
    isCall: nameMatcher(calls),
    blocks: (): boolean => true,
    method: (type: string): string =>
      `calls a method of \`${type}\`, which \`extend-blocking-types\` marks as blocking,`,
    call: (callee: string): string =>
      `calls \`${callee}\`, which \`extend-blocking-calls\` marks as blocking,`,
    waits: "it returns",
    instead: (type: string): string => `an async version of \`${type}\``,
  };
}
