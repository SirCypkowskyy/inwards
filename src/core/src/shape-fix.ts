/**
 * Wording for INW007 and INW008. Messages name the member and the package
 * only, never the allowed list, so a baseline entry survives a change to
 * `allow`. The fix steps list the allowed members and name the member the
 * code most likely belongs in: a built-in synonym, a suffix match, or the
 * closest name within an edit distance of 2 (1 for names of 3 to 5
 * characters, 0 below that, so `db.py` isn't sent to `di.py`).
 */
import type { NameRule, ShapeSpec } from "./shape-config.ts";
import type { Fix } from "./types.ts";

/** Words that name the same kind of module. The first of a group is only a label. */
const SYNONYMS: readonly (readonly string[])[] = [
  ["utils", "util", "helpers", "helper", "misc", "common", "tools", "shared"],
  ["service", "services", "svc", "logic", "manager", "managers", "business"],
  ["models", "model", "entities", "entity", "orm", "tables"],
  ["schemas", "schema", "dto", "dtos", "serializers", "types", "payloads"],
  [
    "router",
    "routers",
    "routes",
    "route",
    "api",
    "endpoints",
    "views",
    "controllers",
    "handlers",
    "urls",
  ],
  ["dependencies", "deps", "dependency"],
  ["config", "settings", "conf", "configuration"],
  ["constants", "const", "consts", "enums"],
  ["exceptions", "exception", "errors", "error", "exc"],
  ["tests", "test", "testing", "conftest"],
  ["use_cases", "usecases", "interactors", "commands", "actions"],
  ["ports", "interfaces", "protocols", "abstractions"],
  ["adapters", "adapter", "repositories", "repository", "repos", "clients", "gateways"],
  ["di", "container", "containers", "wiring", "bootstrap", "composition"],
];
/** A test module's name, whichever side the word is on. */
const TEST_NAME = /^test_|_test$/u;
/** The kind suffix of a listed member. */
const MEMBER_KIND = /(?:\.pyi?|\/)$/u;
/** The kind suffix of a member pattern. */
const PATTERN_KIND = /(?:\.py|\/)$/u;
/** Glob characters: a pattern with one of them names no single member. */
const GLOB = /[*?[]/u;
/** The farthest a misspelt member may be from its target, for long names. */
const MAX_DISTANCE = 2;
/** Characters of the shorter name per allowed edit. */
const CHARS_PER_EDIT = 3;
const ASK =
  "Don't edit [tool.inwards] yourself. If the package really needs this member, ask the user to change its [[tool.inwards.shape]].";

/** A package member that breaks a shape or a names rule. */
export interface Misfit {
  pkg: string;
  /** As listed: `helpers.py`, `services/`. */
  member: string;
}

/**
 * Words a member the shape doesn't allow, or forbids.
 *
 * @param misfit - the package and the member.
 * @param shape - the package's shape.
 * @param forbidden - true when `forbid` matched, false when `allow` didn't.
 * @returns the message and fix.
 */
export function shapeFinding(
  misfit: Misfit,
  shape: ShapeSpec,
  forbidden: boolean,
): { message: string; fix: Fix } {
  const { pkg, member } = misfit;
  const allowed = [...new Set([...(shape.allow ?? []), ...(shape.require ?? [])])].filter(
    (p) => p !== "__init__",
  );
  const target = likelyTarget(member, allowed);
  const dir = `${pkg.replaceAll(".", "/")}/`;
  const steps = [
    ...(target === undefined ? [] : [`Move the code into ${dir}${target} and delete ${member}.`]),
    ...(shape.allow === undefined ? [] : [`Package "${pkg}" may hold: ${allowed.join(", ")}.`]),
    ASK,
  ];
  return {
    message: forbidden
      ? `"${member}" is forbidden in package "${pkg}".`
      : `"${member}" is not an allowed member of package "${pkg}".`,
    fix: {
      summary:
        target === undefined
          ? `Move the code in "${member}" into a member package "${pkg}" allows.`
          : `Move the code in "${member}" into ${target}.`,
      steps,
    },
  };
}

/**
 * Words a member whose name belongs only in other packages.
 *
 * @param misfit - the package and the member.
 * @param rule - the names rule it breaks.
 * @returns the message and fix.
 */
export function nameFinding(misfit: Misfit, rule: NameRule): { message: string; fix: Fix } {
  const { pkg, member } = misfit;
  const home = selectorPath(rule.onlyIn[0] ?? "");
  const where = pkg === "" ? "the config root" : `package "${pkg}"`;
  return {
    message: `"${member}" matches the name pattern "${rule.pattern}", which doesn't belong in ${where}.`,
    fix: {
      summary: `Move "${member}" under ${home}.`,
      steps: [
        `Move it into a package matching ${rule.onlyIn.join(", ")}, for example ${home}.`,
        ASK.replace("its [[tool.inwards.shape]]", "[[tool.inwards.names]]"),
      ],
    },
  };
}

/**
 * Words a required member that is absent.
 *
 * @param pkg - the package.
 * @param pattern - the `require` entry nothing matches.
 * @returns the message and fix.
 */
export function missingFinding(pkg: string, pattern: string): { message: string; fix: Fix } {
  const name = display(pattern);
  const dir = `${pkg.replaceAll(".", "/")}/`;
  return {
    message: `Package "${pkg}" has no "${pattern}" member, which its shape requires.`,
    fix: {
      summary: `Create ${dir}${name}, or put back the one that was removed.`,
      steps: [
        `If ${name} was moved, renamed or deleted, restore it in ${dir}.`,
        `Otherwise create ${dir}${name} for this package's ${pattern} code.`,
        "Don't edit [tool.inwards] yourself. If the package really doesn't need it, ask the user to change `require` in its [[tool.inwards.shape]].",
      ],
    },
  };
}

/**
 * Guesses which allowed member the code in an unexpected one belongs in.
 *
 * @param member - the unexpected member, e.g. `helpers.py`.
 * @param allowed - the shape's allowed and required patterns.
 * @returns the target as a file or directory name, or undefined without a good guess.
 */
function likelyTarget(member: string, allowed: readonly string[]): string | undefined {
  const stem = member.replace(MEMBER_KIND, "");
  const names = allowed.filter((p) => !GLOB.test(p) && p !== "__init__");
  const word = TEST_NAME.test(stem) ? "test" : stem;
  const synonym = names.find((p) =>
    SYNONYMS.some((group) => group.includes(word) && group.includes(bare(p))),
  );
  const suffix = names.find((p) => stem.endsWith(`_${bare(p)}`));
  let closest: string | undefined;
  let best = MAX_DISTANCE + 1;
  for (const p of names) {
    const other = bare(p);
    const limit = Math.min(
      MAX_DISTANCE,
      Math.floor(Math.min(stem.length, other.length) / CHARS_PER_EDIT),
    );
    const d = distance(stem, other);
    if (d <= limit && d < best) {
      [closest, best] = [p, d];
    }
  }
  const target = synonym ?? suffix ?? closest;
  return target === undefined ? undefined : display(target);
}

/**
 * Shows a member pattern as the file or directory an agent would create.
 *
 * @param pattern - `service`, `service.py` or `tests/`.
 * @returns `service.py`, `service.py` or `tests/`.
 */
function display(pattern: string): string {
  return pattern.endsWith("/") || pattern.endsWith(".py") || GLOB.test(pattern)
    ? pattern
    : `${pattern}.py`;
}

/**
 * Drops a pattern's kind suffix.
 *
 * @param pattern - `tests/`, `service.py` or `service`.
 * @returns the bare name.
 */
function bare(pattern: string): string {
  return pattern.replace(PATTERN_KIND, "");
}

/**
 * Shows a selector as a directory: `tests.**` is `tests/`, and `app.*.tests`
 * is `app/`, `*`, `tests/` joined with slashes.
 *
 * @param selector - a package selector.
 * @returns the directory glob.
 */
function selectorPath(selector: string): string {
  const segments = selector.split(".");
  while (segments.at(-1) === "*" || segments.at(-1) === "**") {
    segments.pop();
  }
  return `${segments.join("/")}/`;
}

/**
 * Levenshtein distance between two names.
 *
 * @param a - one name.
 * @param b - the other.
 * @returns the fewest single-character edits between them.
 */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const swap = (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      next.push(Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, swap));
    }
    row = next;
  }
  return row[b.length] ?? 0;
}
