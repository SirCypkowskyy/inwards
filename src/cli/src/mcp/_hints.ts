/**
 * @file What `where_should_this_go` reads from a description in words: which
 * layer it names, and a module name for new code. A word that is a layer's
 * name or the last part of its module prefix picks that layer; otherwise a
 * short vocabulary of roles (an entity or a port is inner code, a use case
 * sits in between, a SQL repository or an HTTP route is outer) picks the
 * innermost, a middle or the outermost layer. It is a hint, never a verdict:
 * the check decides what may be imported where. Pure text work.
 */
import type { LayerSpec } from "@inwards/core";

/** Where in the layer order a kind of code goes. */
type Role = "inner" | "middle" | "outer";

/** Words that say what kind of code something is. */
const ROLE_WORDS: ReadonlyMap<string, Role> = new Map<string, Role>([
  ...words("inner", [
    "entity",
    "entities",
    "value",
    "aggregate",
    "invariant",
    "invariants",
    "domain",
    "business",
    "policy",
    "port",
    "ports",
    "protocol",
    "interface",
    "abstract",
    "abstraction",
  ]),
  ...words("middle", [
    "usecase",
    "usecases",
    "case",
    "service",
    "services",
    "application",
    "workflow",
    "orchestration",
    "orchestrates",
    "interactor",
    "command",
    "commands",
    "query",
    "queries",
  ]),
  ...words("outer", [
    "sql",
    "sqlalchemy",
    "database",
    "db",
    "orm",
    "postgres",
    "postgresql",
    "mysql",
    "sqlite",
    "redis",
    "mongo",
    "http",
    "rest",
    "api",
    "endpoint",
    "endpoints",
    "route",
    "routes",
    "router",
    "controller",
    "view",
    "views",
    "cli",
    "adapter",
    "adapters",
    "gateway",
    "client",
    "queue",
    "kafka",
    "celery",
    "s3",
    "email",
    "smtp",
    "fastapi",
    "django",
    "flask",
    "web",
    "ui",
    "infrastructure",
    "persistence",
    "repository",
    "repositories",
    "migration",
    "migrations",
  ]),
]);

/** What separates words: anything but a lower-case letter or a digit. */
const NON_WORD = /[^a-z0-9]+/u;
/** A Python identifier made of words must start with a letter. */
const STARTS_WITH_LETTER = /^[a-z]/u;
/** How many of a description's words name a new module. */
const NAME_WORDS = 3;

/** Words left out of a module name made from a description. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "for",
  "of",
  "to",
  "and",
  "or",
  "that",
  "which",
  "with",
  "in",
  "on",
  "from",
  "by",
  "new",
  "some",
]);

/**
 * Pairs words with a role.
 *
 * @param role - where in the layer order such code goes.
 * @param list - words that mark such code.
 * @returns the entries.
 */
function words(role: Role, list: readonly string[]): [string, Role][] {
  return list.map((word) => [word, role]);
}

/**
 * Splits a description into lower-case words.
 *
 * @param text - the description.
 * @returns its words, letters and digits only.
 */
function wordsOf(text: string): string[] {
  return text.toLowerCase().split(NON_WORD).filter(Boolean);
}

/**
 * Finds a layer the description names: by its name, a part of its name, or
 * the last part of one of its module prefixes.
 *
 * @param layers - the configured layers.
 * @param said - the description's words.
 * @returns the one layer named, or undefined for none or several.
 */
function namedLayer(layers: readonly LayerSpec[], said: ReadonlySet<string>): string | undefined {
  const named = layers.filter((layer) => {
    const parts = [
      ...layer.name.toLowerCase().split(NON_WORD),
      ...layer.modules.map((m) => m.split(".").at(-1)?.toLowerCase() ?? ""),
    ];
    return parts.some((part) => part !== "" && part !== "*" && said.has(part));
  });
  return named.length === 1 ? named[0]?.name : undefined;
}

/**
 * Picks the role most of the description's role words point to.
 *
 * @param said - the description's words.
 * @returns the role, or undefined for no role word or a tie.
 */
function roleOf(said: readonly string[]): Role | undefined {
  const counts = new Map<Role, number>();
  for (const word of said) {
    const role = ROLE_WORDS.get(word);
    if (role !== undefined) {
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  return first === undefined || (second !== undefined && second[1] === first[1])
    ? undefined
    : first[0];
}

/**
 * Finds the layer a description points to.
 *
 * @param layers - the configured layers, innermost first.
 * @param description - what the code does, if given.
 * @returns the layer's name, or undefined when the description says nothing
 *   clear: no layer named and no role word, a tie, or a middle role with no middle layer.
 */
export function hintOf(
  layers: readonly LayerSpec[],
  description: string | undefined,
): string | undefined {
  if (description === undefined) {
    return undefined;
  }
  const said = wordsOf(description);
  const named = namedLayer(layers, new Set(said));
  if (named !== undefined) {
    return named;
  }
  const role = roleOf(said);
  if (role === undefined) {
    return undefined;
  }
  const ranks = layers.map((layer, i) => layer.rank ?? i);
  const top = Math.max(...ranks);
  return layers.find((_layer, i) => fits(role, ranks[i] ?? i, top))?.name;
}

/**
 * Tells whether a layer's rank suits a role.
 *
 * @param role - inner, middle or outer.
 * @param rank - the layer's rank; 0 is the innermost.
 * @param top - the outermost rank.
 * @returns true for the innermost rank for inner code, the outermost for outer
 *   code, and any rank in between for middle code.
 */
function fits(role: Role, rank: number, top: number): boolean {
  if (role === "inner") {
    return rank === 0;
  }
  return role === "outer" ? rank === top : rank > 0 && rank < top;
}

/**
 * Names a new module: the last part of the module the agent gave, else up to
 * three words of the description joined by `_`, else `new_module`.
 *
 * @param module - the dotted module, if given.
 * @param description - what the code does, if given.
 * @returns a Python identifier.
 */
export function leafOf(module: string | undefined, description: string | undefined): string {
  const last = module?.split(".").at(-1);
  if (last !== undefined) {
    return last;
  }
  const name = wordsOf(description ?? "")
    .filter((word) => !STOP_WORDS.has(word))
    .slice(0, NAME_WORDS)
    .join("_");
  return STARTS_WITH_LETTER.test(name) ? name : "new_module";
}
