/**
 * @file INW006 unassigned-module: code that belongs to no layer is not checked, so
 * an agent that creates `shop/persistence/` and imports it from the domain
 * would escape every rule. This module closes that gap three ways:
 *
 * - an import from a layer into a first-party module outside every layer is an error;
 * - a file outside every layer (and outside `ignore`) gets a warning naming its package;
 * - layer prefixes that match nothing, and layer code moved out of every
 *   layer, are reported against pyproject.toml (see `layout.ts`).
 *
 * A package that holds a literal entry (`shop` above `shop.domain`) is a
 * container by the text of the config alone. A selector names no package,
 * so a package holds one only with evidence: a module below it that the
 * selector matches (`Evidence`, ADR-034).
 */
import { deepestMatch, entryReach, isSelector } from "../../config/layer-selector.ts";
import type { InwardsConfig, LayerSpec } from "../../config/parse.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../../contracts/records.ts";
import type { ModuleLookup } from "../../lookup/module-lookup.ts";
import type { ProjectIndex } from "../../lookup/project-index.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { layerIndexOf } from "../shared/layer-ownership.ts";

/**
 * Tells whether the project has a module at or below a package that a
 * selector matches, with the match itself at or below the package: the
 * evidence that the package holds the selector's layer.
 *
 * @param pkg - a dotted package name.
 * @param selector - a layer selector, e.g. `shop.*.domain`.
 * @returns true when such a module exists.
 */
export type Evidence = (pkg: string, selector: string) => boolean;

/**
 * Takes the evidence from the module index, walking only the directories
 * the selector allows (`ProjectIndex.holdsMatch`).
 *
 * @param project - the module index the engine checks against.
 * @returns a function answering from that index's directory listings.
 */
export function indexEvidence(project: ProjectIndex): Evidence {
  return (pkg: string, selector: string): boolean =>
    project.holdsMatch(pkg, selector, (segments) => entryReach(selector, segments));
}

/**
 * Takes the evidence from a list of module names, as the session checks have them.
 *
 * @param modules - every first-party module.
 * @returns a function answering from those names, cached per package and selector.
 */
export function moduleEvidence(modules: Iterable<string>): Evidence {
  const names = [...modules];
  const cache = new Map<string, boolean>();
  return (pkg: string, selector: string): boolean => {
    const key = `${selector}\u0000${pkg}`;
    let found = cache.get(key);
    if (found === undefined) {
      const depth = pkg.split(".").length;
      found = names.some(
        (m) => (m === pkg || m.startsWith(`${pkg}.`)) && deepestMatch(selector, m) >= depth,
      );
      cache.set(key, found);
    }
    return found;
  };
}

/**
 * Names the package of a module that belongs to no layer: its shortest
 * ancestor that holds no layer. `shop` in a project with `shop.domain` holds a
 * layer, so `shop.persistence.repo` reports `shop.persistence`.
 *
 * @param module - a dotted module name owned by no layer.
 * @param layers - the configured layers.
 * @param evidence - tells whether a package holds a selector's match.
 * @returns the package to report, or undefined when the module only holds layers (e.g. `shop/__init__.py`).
 */
export function unassignedPackage(
  module: string,
  layers: readonly LayerSpec[],
  evidence: Evidence,
): string | undefined {
  const parts = module.split(".");
  for (let end = 1; end <= parts.length; end += 1) {
    const candidate = parts.slice(0, end).join(".");
    if (!holdsLayer(candidate, layers, evidence)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Tells whether a module is, or contains, a layer: a literal prefix equal to
 * it or inside it, or a selector with a matching module at or below it.
 *
 * @param module - a dotted module name.
 * @param layers - the configured layers.
 * @param evidence - tells whether a package holds a selector's match.
 * @returns true when some layer entry lies at or inside the module.
 */
export function holdsLayer(
  module: string,
  layers: readonly LayerSpec[],
  evidence: Evidence,
): boolean {
  return layers.some((layer) =>
    layer.modules.some((entry) =>
      isSelector(entry)
        ? evidence(module, entry)
        : entry === module || entry.startsWith(`${module}.`),
    ),
  );
}

/**
 * Tells whether a module is covered by an `ignore` entry: the entry's segments
 * appear as consecutive whole segments of the module name.
 *
 * @param module - a dotted module name.
 * @param ignore - the configured `ignore` entries.
 * @returns true when any entry matches.
 */
function isIgnored(module: string, ignore: readonly string[]): boolean {
  const name = `.${module}.`;
  return ignore.some((entry) => name.includes(`.${entry}.`));
}

/**
 * Applies INW006 to a file's imports: a file in a layer must not import
 * first-party code that belongs to no layer. That includes the package that
 * only holds layers (`shop` above `shop.domain`): `from shop import x` runs
 * `shop/__init__.py`, which no rule checks, so it could re-export anything.
 * Third-party imports, and imports that land in a layer, pass.
 *
 * @param file - the file the imports come from.
 * @param imports - the imports found in that file, static or dynamic.
 * @param layers - the configured layers, innermost first.
 * @param project - the module index.
 * @param project.ownerOf - finds the first-party module an import target lives in.
 * @param project.evidence - tells whether a package holds a selector's match.
 * @returns one error per import into unassigned first-party code.
 */
export function checkUnassignedImports(
  file: SourceFile,
  imports: readonly ImportRef[],
  layers: readonly LayerSpec[],
  { ownerOf, evidence }: { ownerOf: ModuleLookup; evidence: Evidence },
): Diagnostic[] {
  const source = layers[layerIndexOf(file.module, layers)];
  if (!source) {
    return [];
  }
  const found: Diagnostic[] = [];
  for (const ref of imports) {
    const owner = layerIndexOf(ref.target, layers) === -1 ? ownerOf(ref.target) : undefined;
    if (owner !== undefined) {
      const pkg = unassignedPackage(owner, layers, evidence);
      found.push(
        diagnostic(RULES.INW006, file, {
          span: ref,
          ...(pkg === undefined
            ? aboveLayers(source, ref, owner)
            : outsideLayers(source, ref, pkg)),
        }),
      );
    }
  }
  return found;
}

/**
 * Words an import into a package outside every layer.
 *
 * @param source - the importing layer.
 * @param ref - the import.
 * @param pkg - the unassigned package it lands in.
 * @returns the message and fix.
 */
function outsideLayers(
  source: LayerSpec,
  ref: ImportRef,
  pkg: string,
): { message: string; fix: Diagnostic["fix"] } {
  return {
    message: `Layer "${source.name}" imports "${ref.target}", which belongs to no layer, so no layer rule checks what "${pkg}" imports.`,
    fix: {
      summary: `Move the code into a layer, or ask the user which layer "${pkg}" belongs to.`,
      steps: [
        `If the code belongs to "${source.name}" or an inner layer, move it under that layer's package and import it from there.`,
        `Otherwise ask the user to add "${pkg}" to a layer in [tool.inwards]. Don't edit [tool.inwards] yourself.`,
      ],
    },
  };
}

/**
 * Words an import from the package that holds the layers (its `__init__.py`).
 *
 * @param source - the importing layer.
 * @param ref - the import.
 * @param owner - the layer-holding package.
 * @returns the message and fix.
 */
function aboveLayers(
  source: LayerSpec,
  ref: ImportRef,
  owner: string,
): { message: string; fix: Diagnostic["fix"] } {
  return {
    message: `Layer "${source.name}" imports "${ref.target}" from "${owner}", the package above the layers. Its __init__ belongs to no layer, so it can re-export anything.`,
    fix: {
      summary: `Import from the module in a layer that defines it, not from "${owner}".`,
      steps: [
        `Replace \`${ref.statement}\` with an import from the layer module that defines the name.`,
        `If the code lives in "${owner}"'s __init__.py, move it into a layer.`,
      ],
    },
  };
}

/**
 * Warns about a file that belongs to no layer, unless `ignore` covers it.
 *
 * @param file - a source file.
 * @param config - layers and ignore entries.
 * @param evidence - tells whether a package holds a selector's match.
 * @returns the warning, or undefined for a layered, ignored or layer-holding module.
 */
export function unassignedWarning(
  file: SourceFile,
  config: InwardsConfig,
  evidence: Evidence,
): Diagnostic | undefined {
  const { layers, ignore = [] } = config;
  if (layerIndexOf(file.module, layers) !== -1 || isIgnored(file.module, ignore)) {
    return undefined;
  }
  const pkg = unassignedPackage(file.module, layers, evidence);
  if (pkg === undefined) {
    return undefined;
  }
  return diagnostic(RULES.INW006, file, {
    span: { line: 1, column: 1, endLine: 1, endColumn: 1 },
    severity: "warning",
    message: `"${pkg}" belongs to no layer, so no layer rule checks its imports.`,
    fix: {
      summary: `Put the code under a layer's package, or ask the user to assign "${pkg}".`,
      steps: [
        "If this code is part of the application, move it under the package of the layer it belongs to.",
        `Otherwise ask the user to add "${pkg}" to a layer, or to \`ignore\` in [tool.inwards] if it is tooling. Don't edit [tool.inwards] yourself.`,
      ],
    },
  });
}
