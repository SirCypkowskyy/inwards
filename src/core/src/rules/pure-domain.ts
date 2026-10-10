/**
 * @file INW005 pure-domain: which libraries a layer may import. INW001 only sees
 * first-party layers, so `import sqlalchemy` in the domain passes it. Each
 * layer may set `allow-libraries` and `deny-libraries`; an entry names a
 * module and covers its submodules (`http.client`, `sqlalchemy`).
 *
 * An import is first-party (left to INW001 and INW006) when a layer or the
 * adapter's lookup owns it, stdlib when its top segment is in `STDLIB`, and
 * third-party otherwise. The longest matching entry decides, `allow` on a
 * tie; with no match, a third-party import passes only when the layer sets
 * no `allow-libraries`, and stdlib always passes. The innermost of two or
 * more layers (every sibling of the lowest rank) denies `DEFAULT_DENY` unless it sets `deny-libraries`, and
 * `extend-deny-libraries` adds to whichever of the two applies (#155). On
 * any other layer without `deny-libraries` it adds to an empty list.
 *
 * A third-party import whose top-level package is a uv workspace member (the
 * adapter names them) is called a "workspace package" instead of a library,
 * and its fix points at another package rather than at a port (#203). The
 * check itself is the same; `allow-libraries` covers both.
 *
 * `[tool.inwards.rules.pure-domain].deny` denies libraries to module
 * prefixes that aren't whole layers, such as import-linter's
 * "`mypackage.one` must not import `django`" (#219). It applies to the
 * modules its entries match whether or not a layer owns them, and the
 * layer's `allow-libraries` doesn't undo it. The layer's own lists are asked
 * first, so a library both deny keeps the layer's message, and with it the
 * baseline keys of existing configs.
 */
import { matchEntry } from "../config/layer-selector.ts";
import type { LayerSpec } from "../config/layers.ts";
import type { LibraryDeny } from "../config/rule-options.ts";
import type { Diagnostic, Fix, ImportRef, SourceFile } from "../contracts/records.ts";
import type { ModuleLookup } from "../lookup/module-lookup.ts";
import { diagnostic, RULES } from "../meta/registry.ts";
import { STDLIB } from "../python/stdlib.ts";
import { layerIndexOf, portHome, rankOf } from "./shared/layer-ownership.ts";

/** Frameworks, database and network clients, and stdlib I/O: what the domain gets by default. */
const DEFAULT_DENY: readonly string[] = [
  "aiohttp",
  "alembic",
  "asyncpg",
  "boto3",
  "botocore",
  "celery",
  "django",
  "fastapi",
  "flask",
  "ftplib",
  "grpc",
  "http.client",
  "http.server",
  "httpx",
  "litestar",
  "peewee",
  "pika",
  "psycopg",
  "psycopg2",
  "pymongo",
  "pymysql",
  "redis",
  "requests",
  "smtplib",
  "socket",
  "sqlalchemy",
  "sqlite3",
  "sqlmodel",
  "starlette",
  "subprocess",
  "urllib.request",
  "urllib3",
];

/**
 * Finds the longest entry that covers a module.
 *
 * @param entries - module names; each covers itself and its submodules.
 * @param target - a dotted import target.
 * @returns the entry, or undefined when none covers the target.
 */
function longest(entries: readonly string[], target: string): string | undefined {
  let best: string | undefined;
  for (const entry of entries) {
    const covers = target === entry || target.startsWith(`${entry}.`);
    if (covers && entry.length > (best?.length ?? -1)) {
      best = entry;
    }
  }
  return best;
}

/**
 * Tells whether a layer may import a library, see the module comment.
 *
 * @param layers - the configured layers, innermost first.
 * @param i - the index of the importing layer.
 * @param target - a dotted import target that is not first-party.
 * @returns undefined when the import is allowed; else the deny entry that
 *   matched, or the top-level package when the import is outside `allow-libraries`.
 */
function denial(layers: readonly LayerSpec[], i: number, target: string): string | undefined {
  const layer = layers[i];
  const inner = rankOf(layers, i) === 0 && layers.length > 1;
  const base = layer?.denyLibraries ?? (inner ? DEFAULT_DENY : []);
  const deny = longest([...base, ...(layer?.extendDenyLibraries ?? [])], target);
  const allow = longest(layer?.allowLibraries ?? [], target);
  if (allow !== undefined || deny !== undefined) {
    return (allow?.length ?? -1) >= (deny?.length ?? -1) ? undefined : deny;
  }
  const allowed = layer?.allowLibraries === undefined || STDLIB.has(topOf(target));
  return allowed ? undefined : topOf(target);
}

/** What INW005 needs besides the file and the layers. */
export interface LibraryInputs {
  /** Finds the first-party module an import lands in. */
  ownerOf: ModuleLookup;
  /** The top-level import packages of the uv workspace's members; none by default. */
  workspace?: ReadonlySet<string>;
  /** `[tool.inwards.rules.pure-domain].deny`; none by default. */
  deny?: readonly LibraryDeny[];
}

/** A `deny` entry that matches the importing file: the prefix it matched there, and its libraries. */
interface PrefixDeny {
  prefix: string;
  libraries: readonly string[];
}

/**
 * Finds the `deny` entries whose modules match a file's module.
 *
 * @param deny - `[tool.inwards.rules.pure-domain].deny`.
 * @param module - the importing file's dotted module name.
 * @returns each matching entry once, with the module prefix it matched (the
 *   deepest when several of its entries match).
 */
function prefixDenies(deny: readonly LibraryDeny[], module: string): PrefixDeny[] {
  return deny.flatMap(({ modules, libraries }) => {
    const depth = Math.max(0, ...modules.map((entry) => matchEntry(entry, module)?.depth ?? 0));
    return depth === 0 ? [] : [{ prefix: module.split(".").slice(0, depth).join("."), libraries }];
  });
}

/**
 * Tells whether a `deny` entry covers a module, so the engine reads the
 * imports of a file outside every layer for INW005 too.
 *
 * @param deny - `[tool.inwards.rules.pure-domain].deny`.
 * @param module - a dotted module name.
 * @returns true when an entry's modules match it.
 */
export function coversModule(deny: readonly LibraryDeny[], module: string): boolean {
  return prefixDenies(deny, module).length > 0;
}

/**
 * Finds the prefix deny that covers a target: the longest library entry wins,
 * the first entry on a tie.
 *
 * @param denies - the entries that match the importing file.
 * @param target - a dotted import target.
 * @returns the prefix and the library entry that matched, or undefined.
 */
function prefixDenial(
  denies: readonly PrefixDeny[],
  target: string,
): { prefix: string; entry: string } | undefined {
  let best: { prefix: string; entry: string } | undefined;
  for (const { prefix, libraries } of denies) {
    const entry = longest(libraries, target);
    if (entry !== undefined && entry.length > (best?.entry.length ?? -1)) {
      best = { prefix, entry };
    }
  }
  return best;
}

/**
 * Names the top-level package of a dotted target.
 *
 * @param target - e.g. `sqlalchemy.orm.Session`.
 * @returns e.g. `sqlalchemy`.
 */
function topOf(target: string): string {
  return target.split(".", 1)[0] ?? target;
}

/**
 * Applies INW005 to a file's imports, static or dynamic: a layer, and a
 * module a `deny` entry matches, import only the libraries the config lets
 * them. First-party imports are not its concern.
 *
 * @param file - the file the imports come from.
 * @param imports - the imports found in that file.
 * @param layers - the configured layers, innermost first.
 * @param project - what the adapter knows about the project's packages, and the prefix denies.
 * @param project.ownerOf - finds the first-party module an import lands in.
 * @param project.workspace - the top-level import packages of the uv workspace's members; none by default.
 * @param project.deny - `[tool.inwards.rules.pure-domain].deny`; none by default.
 * @returns one error per import of a library the file may not use.
 */
export function checkLibraries(
  file: SourceFile,
  imports: readonly ImportRef[],
  layers: readonly LayerSpec[],
  { ownerOf, workspace = new Set(), deny = [] }: LibraryInputs,
): Diagnostic[] {
  const from = layerIndexOf(file.module, layers);
  const source = layers[from];
  const denies = prefixDenies(deny, file.module);
  if (!source && denies.length === 0) {
    return [];
  }
  return imports.flatMap((ref) => {
    // Denials first: ownerOf may probe the file system. The other two rule out first-party code.
    const entry = source ? denial(layers, from, ref.target) : undefined;
    const scoped = entry === undefined ? prefixDenial(denies, ref.target) : undefined;
    const denied = entry !== undefined || scoped !== undefined;
    if (!denied || layerIndexOf(ref.target, layers) !== -1 || ownerOf(ref.target) !== undefined) {
      return [];
    }
    const kind = workspace.has(topOf(ref.target)) ? "workspace package" : "library";
    if (source !== undefined && entry !== undefined) {
      return [layerFinding(file, ref, layers, { source, from, entry, kind })];
    }
    return scoped === undefined ? [] : [prefixFinding(file, ref, { ...scoped, kind })];
  });
}

/**
 * Reports an import the layer's own lists forbid, in the wording existing
 * baselines hold.
 *
 * @param file - the importing file.
 * @param ref - the offending import.
 * @param layers - the configured layers, innermost first.
 * @param denied - what matched, and how to call the package.
 * @param denied.source - the importing layer.
 * @param denied.from - its index.
 * @param denied.entry - the deny entry that matched, or the top-level package outside `allow-libraries`.
 * @param denied.kind - "library", or "workspace package" for a uv workspace member.
 * @returns the INW005 error.
 */
function layerFinding(
  file: SourceFile,
  ref: ImportRef,
  layers: readonly LayerSpec[],
  { source, from, entry, kind }: { source: LayerSpec; from: number; entry: string; kind: string },
): Diagnostic {
  const owners = layers.filter((_, i) => i > from && denial(layers, i, ref.target) === undefined);
  return diagnostic(RULES.INW005, file, {
    span: ref,
    message: `Layer "${source.name}" imports "${ref.target}" from ${kind} "${topOf(ref.target)}", which "${source.name}" may not use.`,
    fix:
      kind === "library"
        ? fixFor(source, owners, ref, { entry, home: portHome(file, layers) })
        : workspaceFix(source, ref, entry),
  });
}

/**
 * Reports an import a `deny` entry forbids, naming the module and the prefix
 * the entry matched.
 *
 * @param file - the importing file.
 * @param ref - the offending import.
 * @param denied - what matched, and how to call the package.
 * @param denied.prefix - the module prefix the entry matched, e.g. `mypackage.one`.
 * @param denied.entry - the library entry that covers the import, e.g. `django`.
 * @param denied.kind - "library", or "workspace package" for a uv workspace member.
 * @returns the INW005 error.
 */
function prefixFinding(
  file: SourceFile,
  ref: ImportRef,
  denied: { prefix: string; entry: string; kind: string },
): Diagnostic {
  return diagnostic(RULES.INW005, file, {
    span: ref,
    message: `Module "${file.module}" imports "${ref.target}" from ${denied.kind} "${topOf(ref.target)}", which [tool.inwards.rules.pure-domain] denies to "${denied.prefix}".`,
    fix: prefixFix(ref, denied),
  });
}

/**
 * Says how to delete a forbidden import, for both kinds of fix.
 *
 * @param ref - the offending import.
 * @returns the first step of the fix.
 */
function removeStep(ref: ImportRef): string {
  return `Delete \`${ref.statement}\`. Do not move the import into a function, behind TYPE_CHECKING or into importlib; Inwards checks those too.`;
}

/**
 * Says how to get a package allowed, for both kinds of fix.
 *
 * @param source - the layer that made the import.
 * @param entry - the deny entry that matched, or the top-level package outside `allow-libraries`.
 * @returns the last step of the fix.
 */
function askStep(source: LayerSpec, entry: string): string {
  return `If "${source.name}" should be allowed to use "${entry}", ask the user to add "${entry}" to that layer's allow-libraries in [tool.inwards]. Don't edit [tool.inwards] yourself.`;
}

/**
 * Writes the repair advice for an import of another uv workspace member: the
 * team's own package, so there is no third-party dependency to hide behind a
 * port. Either the code comes from a package the layer may use, or the user
 * allows this one.
 *
 * @param source - the layer that made the import.
 * @param ref - the offending import.
 * @param entry - the deny entry that matched, or the top-level package outside `allow-libraries`.
 * @returns the summary and numbered steps of the fix.
 */
function workspaceFix(source: LayerSpec, ref: ImportRef, entry: string): Fix {
  return {
    summary: `"${source.name}" may not use workspace package "${entry}": use a package it may use, or ask the user to allow "${entry}".`,
    steps: [
      removeStep(ref),
      `"${topOf(ref.target)}" is a member of this uv workspace, not a third-party library. Get what this module needs from a package or workspace member "${source.name}" may use.`,
      askStep(source, entry),
    ],
  };
}

/**
 * Writes the repair advice attached to an INW005 diagnostic: move the library
 * behind a port the layer owns, implemented in an outer layer that may use it.
 * Every such layer is listed, and the agent picks the one that holds adapters:
 * which one that is depends on the architecture, not on the layer order.
 *
 * @param source - the layer that made the import.
 * @param owners - the outer layers allowed to use the library.
 * @param ref - the offending import.
 * @param why - what matched and where the port goes.
 * @param why.entry - the deny entry that matched, or the top-level package outside `allow-libraries`.
 * @param why.home - the importing file's matched prefix, worded by `portHome`.
 * @returns the summary and numbered steps of the fix.
 */
function fixFor(
  source: LayerSpec,
  owners: readonly LayerSpec[],
  ref: ImportRef,
  { entry, home }: { entry: string; home: string },
): Fix {
  const remove = removeStep(ref);
  const ask = askStep(source, entry);
  if (owners.length === 0) {
    return {
      summary: `"${source.name}" may not use "${entry}", and no outer layer may either: ask the user where it belongs.`,
      steps: [remove, ask],
    };
  }
  const allowed = owners.map((layer) => `"${layer.name}"`).join(", ");
  return {
    summary: `Use "${entry}" in an outer layer, behind a port owned by "${source.name}".`,
    steps: [
      remove,
      `Declare a typing.Protocol in ${home} that describes only what this module needs from "${entry}".`,
      "Type this module against that Protocol and receive the implementation through a constructor or function parameter.",
      `Implement the Protocol with "${entry}" in the outer layer that holds adapters (allowed: ${allowed}), and wire it in the outermost layer (the composition root).`,
      ask,
    ],
  };
}

/**
 * Writes the repair advice for an import a `deny` entry forbids: use the
 * library outside the prefix, behind a port the prefix owns. No layer is
 * named, since the prefix may sit inside one or in none.
 *
 * @param ref - the offending import.
 * @param denied - the prefix the entry matched and the library entry that covers the import.
 * @param denied.prefix - the module prefix, e.g. `mypackage.one`.
 * @param denied.entry - the library entry, e.g. `django`.
 * @returns the summary and numbered steps of the fix.
 */
function prefixFix(ref: ImportRef, { prefix, entry }: { prefix: string; entry: string }): Fix {
  return {
    summary: `"${prefix}" may not use "${entry}" ([tool.inwards.rules.pure-domain].deny): use it outside "${prefix}", behind a port "${prefix}" owns.`,
    steps: [
      removeStep(ref),
      `Declare a typing.Protocol in \`${prefix}\` that describes only what this module needs from "${entry}".`,
      "Type this module against that Protocol and receive the implementation through a constructor or function parameter.",
      `Implement the Protocol with "${entry}" in a module outside "${prefix}" that may use it, and wire it in where the application is assembled.`,
      `If "${prefix}" should be allowed to use "${entry}", ask the user to take "${entry}" out of the deny entry for "${prefix}" in [tool.inwards.rules.pure-domain]. Don't edit [tool.inwards] yourself.`,
    ],
  };
}
