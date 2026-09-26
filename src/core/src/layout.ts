/**
 * INW006 layout checks against pyproject.toml: layer prefixes that match no
 * module (a warning for one dead prefix, an error when a whole layer matches
 * nothing or a prefix stopped matching during the session), and layer code
 * moved out of every layer during a session. Both apply `[tool.inwards.rules]`.
 */
import type { InwardsConfig } from "./config.ts";
import { layerIndexOf } from "./layers.ts";
import { applyRules } from "./rule-config.ts";
import { diagnostic, RULES } from "./rules.ts";
import type { Diagnostic, SourceFile, Span } from "./types.ts";
import { holdsLayer, unassignedPackage } from "./unassigned.ts";

/** The `[tool.inwards]` header line, however it is spaced. */
const TABLE_HEADER = /^[ \t]*\[[ \t]*tool[ \t]*\.[ \t]*inwards[ \t]*\]/mu;

/** The pyproject.toml the layers came from, so config findings can point into it. */
export interface ConfigFile {
  /** Path as the user should see it. */
  path: string;
  text: string;
}

/**
 * Checks the layer prefixes against the modules that exist. A prefix that
 * matches nothing is a warning (often a typo), a layer none of whose prefixes
 * match is an error, and so is a prefix that matched at session start but no
 * longer does, since moving a layer's package takes it out of the check.
 *
 * @param config - the layers.
 * @param modules - every first-party module now.
 * @param file - the pyproject.toml, to point at each prefix.
 * @param before - the modules at session start, when a session is being checked.
 * @returns the findings, located at each prefix in the file.
 */
export function checkPrefixes(
  config: InwardsConfig,
  modules: ReadonlySet<string>,
  file: ConfigFile,
  before?: ReadonlySet<string>,
): Diagnostic[] {
  const found: Diagnostic[] = [];
  const source: SourceFile = { path: file.path, module: "", isPackage: false, text: file.text };
  for (const layer of config.layers) {
    const dead = layer.modules.filter((prefix) => !matchesAny(prefix, modules));
    for (const prefix of dead) {
      const vanished = before !== undefined && matchesAny(prefix, before);
      const whole = dead.length === layer.modules.length;
      const message = vanished
        ? `"${prefix}" (layer "${layer.name}") matched modules when the session started and matches none now.`
        : `"${prefix}" (layer "${layer.name}") matches no module${whole ? `, so layer "${layer.name}" is empty` : ""}.`;
      found.push(
        diagnostic(RULES.INW006, source, {
          span: spanOf(file.text, prefix),
          severity: vanished || whole ? "error" : "warning",
          message,
          fix: prefixFix(prefix, vanished),
        }),
      );
    }
  }
  return applyRules(found, config.rules);
}

/** SHA-256 of an empty file: every empty `__init__.py` has it, so it proves no move. */
// biome-ignore lint/security/noSecrets: the well-known hash of empty input, not a credential
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * Catches layer code moved out of every layer during a session: a layer
 * module disappeared and a module outside every layer appeared, either inside
 * a package that holds layers (`shop/core` next to `shop/domain`, whatever it
 * is called now) or elsewhere with the same file name or the same (non-empty)
 * content. A renamed and edited move to a new top-level module is not caught;
 * any layer importing it still gets an INW006 error. An empty `__init__.py` left
 * behind keeps the prefix alive, so `checkPrefixes` alone doesn't see such a
 * move. `ignore` doesn't exempt the new module: tooling doesn't come from a layer.
 *
 * @param config - the layers.
 * @param before - module name to content hash, at session start.
 * @param now - module name to content hash, now.
 * @param file - the pyproject.toml, to point at the layer.
 * @returns one error per layer that lost modules to a move.
 */
export function checkMoves(
  config: InwardsConfig,
  before: ReadonlyMap<string, string>,
  now: ReadonlyMap<string, string>,
  file: ConfigFile,
): Diagnostic[] {
  const { layers } = config;
  const appeared = [...now].filter(
    ([m]) =>
      !before.has(m) &&
      layerIndexOf(m, layers) === -1 &&
      unassignedPackage(m, layers) !== undefined,
  );
  const source: SourceFile = { path: file.path, module: "", isPackage: false, text: file.text };
  const found = layers.flatMap((layer, i) => {
    const lost = [...before].filter(([m]) => !now.has(m) && layerIndexOf(m, layers) === i);
    const moved = appeared.filter(
      ([m, hash]) =>
        lost.length > 0 &&
        (holdsLayer(m.split(".")[0] ?? m, layers) || lost.some((l) => sameFile(l, [m, hash]))),
    );
    if (moved.length === 0) {
      return [];
    }
    const names = moved.map(([m]) => m).join(", ");
    return [
      diagnostic(RULES.INW006, source, {
        span: spanOf(file.text, layer.modules[0] ?? layer.name),
        message: `${names} moved out of layer "${layer.name}" to outside every layer, where nothing checks it.`,
        fix: {
          summary: "Move the code back into its layer, or ask the user.",
          steps: [
            `Undo the move: put ${names} back under "${layer.name}".`,
            "If the code really belongs outside the layers, stop and ask the user; don't edit [tool.inwards] yourself.",
          ],
        },
      }),
    ];
  });
  return applyRules(found, config.rules);
}

/**
 * Tells whether a vanished module and a new one look like the same file:
 * the same last name segment (not `__init__`), or the same non-empty content.
 *
 * @param lost - the vanished module and its hash.
 * @param found - the new module and its hash.
 * @returns true when the new module is probably the old one, moved.
 */
function sameFile(lost: readonly [string, string], found: readonly [string, string]): boolean {
  const name = lastSegment(found[0]);
  const sameName = lastSegment(lost[0]) === name && name !== "__init__";
  return sameName || (lost[1] === found[1] && found[1] !== EMPTY_HASH);
}

/**
 * Takes the last segment of a dotted name.
 *
 * @param module - e.g. `shop.domain.order`.
 * @returns e.g. `order`.
 */
function lastSegment(module: string): string {
  return module.split(".").at(-1) ?? module;
}

/**
 * Tells whether a layer prefix matches any module.
 *
 * @param prefix - a layer prefix.
 * @param modules - module names.
 * @returns true when a module equals the prefix or lies inside it.
 */
function matchesAny(prefix: string, modules: ReadonlySet<string>): boolean {
  if (modules.has(prefix)) {
    return true;
  }
  const inside = `${prefix}.`;
  for (const module of modules) {
    if (module.startsWith(inside)) {
      return true;
    }
  }
  return false;
}

/**
 * Writes the repair advice for a dead prefix.
 *
 * @param prefix - the prefix that matches nothing.
 * @param vanished - true when it matched at session start.
 * @returns the fix.
 */
function prefixFix(prefix: string, vanished: boolean): Diagnostic["fix"] {
  if (vanished) {
    return {
      summary: `Move the modules back under "${prefix}".`,
      steps: [
        `Undo the move or rename that emptied "${prefix}"; code outside every layer is not checked.`,
        "If the package really must move, ask the user to update [tool.inwards]. Don't edit it yourself.",
      ],
    };
  }
  return {
    summary: `Ask the user to fix or remove "${prefix}" in [tool.inwards].`,
    steps: [
      "Check the prefix for a typo: a prefix that matches nothing leaves the code it was meant for unchecked.",
      "Don't edit [tool.inwards] yourself; tell the user.",
    ],
  };
}

/**
 * Locates a prefix's quoted string in pyproject.toml, for the diagnostic span.
 * The search starts at the `[tool.inwards]` header, so `"shop"` doesn't land
 * on `name = "shop"` in `[project]`.
 * ponytail: first quoted occurrence after the header; parse positions from TOML if this ever points wrong.
 *
 * @param text - the pyproject.toml text.
 * @param prefix - the prefix to find.
 * @returns the span of the string, or line 1 column 1 when it isn't spelled plainly.
 */
export function spanOf(text: string, prefix: string): Span {
  const from = TABLE_HEADER.exec(text)?.index ?? 0;
  const [at] = [`"${prefix}"`, `'${prefix}'`]
    .map((quoted) => text.indexOf(quoted, from))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b);
  if (at === undefined) {
    return { line: 1, column: 1, endLine: 1, endColumn: 1 };
  }
  const before = text.slice(0, at).split("\n");
  const line = before.length;
  const column = (before.at(-1)?.length ?? 0) + 1;
  return { line, column, endLine: line, endColumn: column + prefix.length + 2 };
}
