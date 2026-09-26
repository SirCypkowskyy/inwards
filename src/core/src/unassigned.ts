/**
 * INW006 unassigned-module: code that belongs to no layer is not checked, so
 * an agent that creates `shop/persistence/` and imports it from the domain
 * would escape every rule. This module closes that gap three ways:
 *
 * - an import from a layer into a first-party module outside every layer is an error;
 * - a file outside every layer (and outside `ignore`) gets a warning naming its package;
 * - layer prefixes that match nothing, and layer code moved out of every
 *   layer, are reported against pyproject.toml (see `layout.ts`).
 */
import type { InwardsConfig, LayerSpec } from "./config.ts";
import { layerIndexOf } from "./layers.ts";
import { diagnostic, RULES } from "./rules.ts";
import type { Diagnostic, ImportRef, SourceFile } from "./types.ts";

/**
 * Finds the first-party module an import target lives in, what INW006 asks
 * the module index (`ProjectIndex.ownerOf`, built by `probeLookup`).
 *
 * @param target - a resolved dotted import target.
 * @returns the owning first-party module, or undefined for third-party code.
 */
export type ModuleLookup = (target: string) => string | undefined;

/** What an adapter's file system says is at a path: a file, a directory, or nothing. */
export type PathKind = (relPath: string) => "file" | "dir" | undefined;

/**
 * Builds a ModuleLookup from the adapter's file system, following Python's
 * import rules for a first-party module under the config root:
 *
 * - `a/b.py` or `a/b.pyi` is module `a.b`;
 * - a directory `a/b` below a top-level package is a package (a namespace
 *   package needs no `__init__.py`);
 * - a top-level directory counts only with an `__init__.py`: a bare `logging/`
 *   or `docker/` folder loses to the stdlib or site-packages module of that name.
 *
 * The longest existing prefix of a target wins.
 *
 * @param kind - tells what is at a forward-slash path relative to the config root.
 * @returns the lookup.
 */
export function probeLookup(kind: PathKind): ModuleLookup {
  return (target: string): string | undefined => {
    const parts = target.split(".");
    let end = parts.length;
    while (end > 0 && !isModule(kind, parts.slice(0, end))) {
      end -= 1;
    }
    return end === 0 ? undefined : parts.slice(0, end).join(".");
  };
}

/**
 * Tells whether a dotted name is a first-party module on disk (see `probeLookup`).
 *
 * @param kind - the adapter's view of the file system.
 * @param segments - the module name, split on dots.
 * @returns true for a module file, a nested package directory, or a top-level package with `__init__`.
 */
function isModule(kind: PathKind, segments: readonly string[]): boolean {
  const base = segments.join("/");
  if (kind(`${base}.py`) === "file" || kind(`${base}.pyi`) === "file") {
    return true;
  }
  if (kind(base) !== "dir") {
    return false;
  }
  return (
    segments.length > 1 ||
    kind(`${base}/__init__.py`) === "file" ||
    kind(`${base}/__init__.pyi`) === "file"
  );
}

/**
 * Names the package of a module that belongs to no layer: its shortest
 * ancestor that holds no layer. `shop` in a project with `shop.domain` holds a
 * layer, so `shop.persistence.repo` reports `shop.persistence`.
 *
 * @param module - a dotted module name owned by no layer.
 * @param layers - the configured layers.
 * @returns the package to report, or undefined when the module only holds layers (e.g. `shop/__init__.py`).
 */
export function unassignedPackage(
  module: string,
  layers: readonly LayerSpec[],
): string | undefined {
  const parts = module.split(".");
  for (let end = 1; end <= parts.length; end += 1) {
    const candidate = parts.slice(0, end).join(".");
    if (!holdsLayer(candidate, layers)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Tells whether a module is, or contains, a layer prefix.
 *
 * @param module - a dotted module name.
 * @param layers - the configured layers.
 * @returns true when some prefix equals the module or lies inside it.
 */
export function holdsLayer(module: string, layers: readonly LayerSpec[]): boolean {
  return layers.some((layer) =>
    layer.modules.some((prefix) => prefix === module || prefix.startsWith(`${module}.`)),
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
 * @param ownerOf - finds the first-party module an import target lives in.
 * @returns one error per import into unassigned first-party code.
 */
export function checkUnassignedImports(
  file: SourceFile,
  imports: readonly ImportRef[],
  layers: readonly LayerSpec[],
  ownerOf: ModuleLookup,
): Diagnostic[] {
  const source = layers[layerIndexOf(file.module, layers)];
  if (!source) {
    return [];
  }
  const found: Diagnostic[] = [];
  for (const ref of imports) {
    const owner = layerIndexOf(ref.target, layers) === -1 ? ownerOf(ref.target) : undefined;
    if (owner !== undefined) {
      const pkg = unassignedPackage(owner, layers);
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
    message: `Layer "${source.name}" imports "${ref.target}", which belongs to no layer, so nothing checks what "${pkg}" imports.`,
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
 * @returns the warning, or undefined for a layered, ignored or layer-holding module.
 */
export function unassignedWarning(file: SourceFile, config: InwardsConfig): Diagnostic | undefined {
  const { layers, ignore = [] } = config;
  if (layerIndexOf(file.module, layers) !== -1 || isIgnored(file.module, ignore)) {
    return undefined;
  }
  const pkg = unassignedPackage(file.module, layers);
  if (pkg === undefined) {
    return undefined;
  }
  return diagnostic(RULES.INW006, file, {
    span: { line: 1, column: 1, endLine: 1, endColumn: 1 },
    severity: "warning",
    message: `"${pkg}" belongs to no layer, so its imports are not checked.`,
    fix: {
      summary: `Put the code under a layer's package, or ask the user to assign "${pkg}".`,
      steps: [
        "If this code is part of the application, move it under the package of the layer it belongs to.",
        `Otherwise ask the user to add "${pkg}" to a layer, or to \`ignore\` in [tool.inwards] if it is tooling. Don't edit [tool.inwards] yourself.`,
      ],
    },
  });
}
