/**
 * INW006 layout checks against pyproject.toml: layer prefixes that match no
 * module (a warning for one dead prefix, an error when a whole layer matches
 * nothing or a prefix stopped matching during the session), and layer code
 * moved out of every layer during a session.
 *
 * `[tool.inwards.rules]` applies to `checkPrefixes` without a session start
 * only. The session comparison (a prefix emptied since the start, layer code
 * moved out of every layer) is the Stop gate's defence against moving a layer
 * away, not a rule a team phases in, so like INW000 the table can't turn it
 * off (ADR-027).
 */
import type { InwardsConfig } from "../../config/parse.ts";
import { applyRules } from "../../config/rule-settings.ts";
import { type ConfigFile, spanOf } from "../../config/source-span.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { layerIndexOf } from "../shared/layer-ownership.ts";
import { holdsLayer, unassignedPackage } from "./imports.ts";

/**
 * Checks the layer prefixes against the modules that exist. A prefix that
 * matches nothing is a warning (often a typo), a layer none of whose prefixes
 * match is an error, and so is a prefix that matched at session start but no
 * longer does, since moving a layer's package takes it out of the check.
 *
 * @param config - the layers.
 * @param modules - every first-party module now.
 * @param file - the pyproject.toml, to point at each prefix.
 * @param before - the modules at session start, when a session is being checked;
 *   then `[tool.inwards.rules]` doesn't apply.
 * @returns the findings, located at each prefix in the file.
 */
export function checkPrefixes(
  config: InwardsConfig,
  modules: ReadonlySet<string>,
  file: ConfigFile,
  before?: ReadonlySet<string>,
): Diagnostic[] {
  const found = prefixFindings(config, modules, file, before);
  return before === undefined ? applyRules(found, config.rules) : found;
}

/**
 * Finds the prefix findings `checkPrefixes` reports, before `[tool.inwards.rules]`.
 *
 * @param config - the layers.
 * @param modules - every first-party module now.
 * @param file - the pyproject.toml, to point at each prefix.
 * @param before - the modules at session start, when a session is being checked.
 * @returns the findings, located at each prefix in the file.
 */
function prefixFindings(
  config: InwardsConfig,
  modules: ReadonlySet<string>,
  file: ConfigFile,
  before: ReadonlySet<string> | undefined,
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
  return found;
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
  return layers.flatMap((layer, i) => {
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
