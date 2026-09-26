/**
 * INW005 pure-domain: which libraries a layer may import. INW001 only sees
 * first-party layers, so `import sqlalchemy` in the domain passes it. Each
 * layer may set `allow-libraries` and `deny-libraries`; an entry names a
 * module and covers its submodules (`http.client`, `sqlalchemy`).
 *
 * An import is first-party (left to INW001 and INW006) when a layer or the
 * adapter's lookup owns it, stdlib when its top segment is in `STDLIB`, and
 * third-party otherwise. The longest matching entry decides, `allow` on a
 * tie; with no match, a third-party import passes only when the layer sets
 * no `allow-libraries`, and stdlib always passes. The innermost of two or
 * more layers denies `DEFAULT_DENY` unless it sets `deny-libraries`, and
 * `extend-deny-libraries` adds to whichever of the two applies (#155).
 */
import type { LayerSpec } from "./config.ts";
import { layerIndexOf } from "./layers.ts";
import { diagnostic, RULES } from "./rules.ts";
import { STDLIB } from "./stdlib.ts";
import type { Diagnostic, Fix, ImportRef, SourceFile } from "./types.ts";
import type { ModuleLookup } from "./unassigned.ts";

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
  const inner = i === 0 && layers.length > 1;
  const base = layer?.denyLibraries ?? (inner ? DEFAULT_DENY : []);
  const deny = longest([...base, ...(layer?.extendDenyLibraries ?? [])], target);
  const allow = longest(layer?.allowLibraries ?? [], target);
  if (allow !== undefined || deny !== undefined) {
    return (allow?.length ?? -1) >= (deny?.length ?? -1) ? undefined : deny;
  }
  const allowed = layer?.allowLibraries === undefined || STDLIB.has(topOf(target));
  return allowed ? undefined : topOf(target);
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
 * Applies INW005 to a file's imports, static or dynamic: a layer imports only
 * the libraries its config lets it. First-party imports are not its concern.
 *
 * @param file - the file the imports come from.
 * @param imports - the imports found in that file.
 * @param layers - the configured layers, innermost first.
 * @param ownerOf - finds the first-party module an import lands in.
 * @returns one error per import of a library the layer may not use.
 */
export function checkLibraries(
  file: SourceFile,
  imports: readonly ImportRef[],
  layers: readonly LayerSpec[],
  ownerOf: ModuleLookup,
): Diagnostic[] {
  const from = layerIndexOf(file.module, layers);
  const source = layers[from];
  if (!source) {
    return [];
  }
  const found: Diagnostic[] = [];
  for (const ref of imports) {
    // denial() first: ownerOf may probe the file system. The other two rule out first-party code.
    const entry = denial(layers, from, ref.target);
    if (
      entry !== undefined &&
      layerIndexOf(ref.target, layers) === -1 &&
      ownerOf(ref.target) === undefined
    ) {
      const owners = layers.filter(
        (_, i) => i > from && denial(layers, i, ref.target) === undefined,
      );
      found.push(
        diagnostic(RULES.INW005, file, {
          span: ref,
          message: `Layer "${source.name}" imports "${ref.target}" from library "${topOf(ref.target)}", which "${source.name}" may not use.`,
          fix: fixFor(source, owners, ref, entry),
        }),
      );
    }
  }
  return found;
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
 * @param entry - the deny entry that matched, or the top-level package outside `allow-libraries`.
 * @returns the summary and numbered steps of the fix.
 */
function fixFor(
  source: LayerSpec,
  owners: readonly LayerSpec[],
  ref: ImportRef,
  entry: string,
): Fix {
  const remove = `Delete \`${ref.statement}\`. Do not move the import into a function, behind TYPE_CHECKING or into importlib; Inwards checks those too.`;
  const ask = `If "${source.name}" should be allowed to use "${entry}", ask the user to add "${entry}" to that layer's allow-libraries in [tool.inwards]. Don't edit [tool.inwards] yourself.`;
  if (owners.length === 0) {
    return {
      summary: `"${source.name}" may not use "${entry}", and no outer layer may either: ask the user where it belongs.`,
      steps: [remove, ask],
    };
  }
  const home = source.modules[0] ?? source.name;
  const allowed = owners.map((layer) => `"${layer.name}"`).join(", ");
  return {
    summary: `Use "${entry}" in an outer layer, behind a port owned by "${source.name}".`,
    steps: [
      remove,
      `Declare a typing.Protocol in \`${home}\` (for example \`${home}.ports\`) that describes only what this module needs from "${entry}".`,
      "Type this module against that Protocol and receive the implementation through a constructor or function parameter.",
      `Implement the Protocol with "${entry}" in the outer layer that holds adapters (allowed: ${allowed}), and wire it in the outermost layer (the composition root).`,
      ask,
    ],
  };
}
