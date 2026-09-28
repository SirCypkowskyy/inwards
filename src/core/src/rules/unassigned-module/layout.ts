/**
 * @file INW006 layout checks against pyproject.toml: layer prefixes that match no
 * module (a warning for one dead prefix, an error when a whole layer matches
 * nothing or a prefix stopped matching during the session), and layer code
 * moved out of every layer during a session, and nested projects (uv workspace
 * members) whose code gets path-derived names nothing imports it by.
 *
 * `[tool.inwards.rules]` applies to `checkPrefixes` without a session start
 * only. The session comparison (a prefix emptied since the start, layer code
 * moved out of every layer) is the Stop gate's defence against moving a layer
 * away, not a rule a team phases in, so like INW000 the table can't turn it
 * off (ADR-027).
 *
 * A selector (`shop.*.domain`) is dead when it matches no module, whatever
 * the precedence. In a session it is also checked slice by slice, a slice
 * being a module's prefix up to the selector's last literal segment
 * (`shop.orders.domain`), so emptying one slice while another keeps the
 * selector alive is still caught (ADR-034).
 */
import { isSelector, matchEntry } from "../../config/layer-selector.ts";
import type { LayerSpec } from "../../config/layers.ts";
import type { InwardsConfig } from "../../config/parse.ts";
import { applyRules } from "../../config/rule-settings.ts";
import { type ConfigFile, spanOf } from "../../config/source-span.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import type { PathKind } from "../../lookup/module-lookup.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { layerMembership } from "../shared/layer-ownership.ts";
import { holdsLayer, moduleEvidence, unassignedPackage } from "./imports.ts";

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
  return config.layers.flatMap((layer) => {
    const dead = layer.modules.filter((prefix) => !matchesAny(prefix, modules));
    return [
      ...deadEntries(layer, dead, file, before),
      ...(before === undefined ? [] : emptiedSlices(layer, { modules, before, dead }, file)),
    ];
  });
}

/**
 * Reports a layer's entries that match no module: a warning for one dead
 * entry, an error when the whole layer is empty or the entry matched at
 * session start.
 *
 * @param layer - the layer the entries belong to.
 * @param dead - its entries that match nothing now.
 * @param file - the pyproject.toml, to point at each entry.
 * @param before - the modules at session start, when a session is being checked.
 * @returns one finding per dead entry.
 */
function deadEntries(
  layer: LayerSpec,
  dead: readonly string[],
  file: ConfigFile,
  before: ReadonlySet<string> | undefined,
): Diagnostic[] {
  const source: SourceFile = { path: file.path, module: "", isPackage: false, text: file.text };
  return dead.map((prefix) => {
    const vanished = before !== undefined && matchesAny(prefix, before);
    const whole = dead.length === layer.modules.length;
    const message = vanished
      ? `"${prefix}" (layer "${layer.name}") matched modules when the session started and matches none now.`
      : `"${prefix}" (layer "${layer.name}") matches no module${whole ? `, so layer "${layer.name}" is empty` : ""}.`;
    return diagnostic(RULES.INW006, source, {
      span: spanOf(file.text, prefix),
      severity: vanished || whole ? "error" : "warning",
      message,
      fix: prefixFix(prefix, vanished),
    });
  });
}

/**
 * Finds the slices of a layer's selectors that held modules at session start
 * and hold none now (no module is the slice or lies under it), while the selector itself still matches elsewhere:
 * `shop.billing.domain` moved away under `shop.*.domain`, with
 * `shop.orders.domain` still there. Deleting or renaming a slice needs the
 * user, as removing a literal entry's package does: a move into a directory
 * the walk skips looks exactly like a deletion.
 *
 * @param layer - the layer whose selectors are compared.
 * @param sets - the module sets.
 * @param sets.modules - every first-party module now.
 * @param sets.before - the modules at session start.
 * @param sets.dead - the layer's entries that match nothing now, already reported.
 * @param file - the pyproject.toml, to point at each selector.
 * @returns one error per emptied slice.
 */
function emptiedSlices(
  layer: LayerSpec,
  {
    modules,
    before,
    dead,
  }: { modules: ReadonlySet<string>; before: ReadonlySet<string>; dead: readonly string[] },
  file: ConfigFile,
): Diagnostic[] {
  const source: SourceFile = { path: file.path, module: "", isPackage: false, text: file.text };
  return layer.modules
    .filter((entry) => isSelector(entry) && !dead.includes(entry))
    .flatMap((entry) =>
      // A slice lives on while any module is it or lies under it, matched or
      // not: `shop.orders.infra/__init__.py` keeps `shop.*.infra.*`'s slice.
      [...slicesOf(entry, before)]
        .filter((slice) => !matchesAny(slice, modules))
        .map((slice) =>
          diagnostic(RULES.INW006, source, {
            span: spanOf(file.text, entry),
            message: `"${slice}" (matched by "${entry}", layer "${layer.name}") held modules when the session started and holds none now.`,
            fix: prefixFix(slice, true),
          }),
        ),
    );
}

/**
 * Names the slices a selector matches: each matched module's prefix up to the
 * selector's last literal segment. `shop.**` has the one slice `shop`, so
 * routine edits under it never empty a slice; `shop.*.infra.*` has
 * `shop.orders.infra`, not one slice per module.
 *
 * @param selector - a layer selector.
 * @param modules - module names.
 * @returns the slices, as dotted names.
 */
function slicesOf(selector: string, modules: ReadonlySet<string>): Set<string> {
  const slices = new Set<string>();
  for (const module of modules) {
    const match = matchEntry(selector, module);
    if (match !== undefined) {
      slices.add(module.split(".").slice(0, match.lastLiteral).join("."));
    }
  }
  return slices;
}

/**
 * Warns about nested projects under the config root: a directory with its own
 * pyproject.toml whose code sits in a `src/` folder, as in a uv workspace
 * (`packages/core/src/core`). Its package is indexed as `packages.core.src.core`,
 * but other code imports it as `core`, which matches no module and so passes
 * as a third-party import: a layer violation between members goes unseen.
 * Each member needs its own config; `inwards check` at the workspace root
 * then checks it with that config and leaves its files out of this one (#57).
 *
 * @param config - the config, for its root and `[tool.inwards.rules]`.
 * @param file - the pyproject.toml, to point at `root`.
 * @param tree - what is under the config root.
 * @param tree.modules - every first-party module now.
 * @param tree.kind - probes a path relative to the config root.
 * @param tree.shownRoot - the config root as report paths show it (`""` or `src`).
 * @returns one warning per nested project.
 */
export function checkNestedProjects(
  config: InwardsConfig,
  file: ConfigFile,
  { modules, kind, shownRoot }: { modules: ReadonlySet<string>; kind: PathKind; shownRoot: string },
): Diagnostic[] {
  const nested = new Map<string, Set<string>>();
  for (const module of modules) {
    const parts = module.split(".");
    // A package right under a `src` below the root, at any depth (`src.packages.core.src.core`
    // with root "."); a `src` at the root itself is a single project.
    for (let src = 1; src + 1 < parts.length; src += 1) {
      if (parts[src] !== "src") {
        continue;
      }
      const dir = parts.slice(0, src).join("/");
      const packages = nested.get(dir) ?? new Set<string>();
      packages.add(parts.slice(0, src + 2).join("."));
      nested.set(dir, packages);
    }
  }
  const source: SourceFile = { path: file.path, module: "", isPackage: false, text: file.text };
  const found = [...nested]
    .filter(([dir]) => kind(`${dir}/pyproject.toml`) === "file")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, packages]) => {
      const shown = [shownRoot, dir].filter(Boolean).join("/");
      const names = [...packages].sort();
      const short = names.map((name) => name.split(".").at(-1) ?? name);
      return diagnostic(RULES.INW006, source, {
        span: spanOf(file.text, config.root),
        severity: "warning",
        message: `${shown} is a nested project with its own pyproject.toml: its code is indexed as ${names.join(", ")}, so an import of ${short.join(", ")} is taken for a third-party import and not checked.`,
        fix: {
          summary: `Check ${shown} with its own [tool.inwards].`,
          steps: [
            `Give ${shown}/pyproject.toml its own [tool.inwards]; \`inwards check\` at the workspace root then checks it with that config.`,
            "Don't edit [tool.inwards] yourself; tell the user.",
          ],
        },
      });
    });
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
  const evidence = moduleEvidence(now.keys());
  const appeared = [...now].filter(
    ([m]) =>
      !before.has(m) &&
      layerMembership(m, layers) === undefined &&
      unassignedPackage(m, layers, evidence) !== undefined,
  );
  const source: SourceFile = { path: file.path, module: "", isPackage: false, text: file.text };
  return layers.flatMap((layer, i) => {
    const lost = [...before].filter(
      ([m]) => !now.has(m) && layerMembership(m, layers)?.index === i,
    );
    const moved = appeared.filter(
      ([m, hash]) =>
        lost.length > 0 &&
        (holdsLayer(m.split(".")[0] ?? m, layers, evidence) ||
          lost.some((l) => sameFile(l, [m, hash]))),
    );
    const [first] = lost;
    if (moved.length === 0 || first === undefined) {
      return [];
    }
    const names = moved.map(([m]) => m).join(", ");
    // The entry the first lost module belonged to: the selector text, for a selector.
    const entry = layerMembership(first[0], layers)?.entry ?? layer.name;
    return [
      diagnostic(RULES.INW006, source, {
        span: spanOf(file.text, entry),
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
 * Tells whether a layer entry matches any module, whatever the precedence.
 *
 * @param prefix - a layer prefix or selector.
 * @param modules - module names.
 * @returns true when a module equals the prefix or lies inside it, or the selector matches one.
 */
function matchesAny(prefix: string, modules: ReadonlySet<string>): boolean {
  if (isSelector(prefix)) {
    return [...modules].some((module) => matchEntry(prefix, module) !== undefined);
  }
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
 * @returns a summary and steps: restore the package, or fix or drop the prefix.
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
