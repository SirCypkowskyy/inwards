/**
 * INW006 unassigned-module: code that belongs to no layer is not checked, so
 * an agent that creates `shop/persistence/` and imports it from the domain
 * would escape every rule. This module closes that gap three ways:
 *
 * - an import from a layer into a first-party module outside every layer is an error;
 * - a file outside every layer (and outside `ignore`) gets a warning naming its package;
 * - layer prefixes that match nothing are reported against pyproject.toml:
 *   a warning for one dead prefix, an error when a whole layer matches nothing
 *   or a prefix stopped matching during the session (`git mv shop/domain shop/core`).
 */
import type { InwardsConfig, LayerSpec } from "./config.ts";
import { layerIndexOf } from "./layers.ts";
import { diagnostic, RULES } from "./rules.ts";
import type { Diagnostic, ImportRef, SourceFile, Span } from "./types.ts";

/**
 * Finds the first-party module an import target lives in, the port INW006
 * needs from the adapter (see `probeLookup`).
 *
 * @param target - a resolved dotted import target.
 * @returns the owning first-party module, or undefined for third-party code.
 */
export type ModuleLookup = (target: string) => string | undefined;

/**
 * Builds a ModuleLookup from a probe the adapter implements with its file
 * system: does `a/b/c.py`, `a/b/c.pyi` or a directory `a/b/c` exist under the
 * config root? A directory counts, since Python imports a namespace package
 * (no `__init__.py`) too. The longest existing prefix of a target wins.
 *
 * @param exists - tells whether a module path, as name segments, exists under the root.
 * @returns the lookup.
 */
export function probeLookup(exists: (segments: readonly string[]) => boolean): ModuleLookup {
  return (target: string): string | undefined => {
    const parts = target.split(".");
    let end = parts.length;
    while (end > 0 && !exists(parts.slice(0, end))) {
      end -= 1;
    }
    return end === 0 ? undefined : parts.slice(0, end).join(".");
  };
}

/** The pyproject.toml the layers came from, so config findings can point into it. */
export interface ConfigFile {
  /** Path as the user should see it. */
  path: string;
  text: string;
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
function unassignedPackage(module: string, layers: readonly LayerSpec[]): string | undefined {
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
function holdsLayer(module: string, layers: readonly LayerSpec[]): boolean {
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
 * first-party code that belongs to no layer. Third-party imports, and
 * packages that only hold layers (`from shop import VERSION`), pass.
 *
 * @param file - the file the imports come from.
 * @param imports - the imports found in that file.
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
    const pkg = owner === undefined ? undefined : unassignedPackage(owner, layers);
    if (pkg !== undefined) {
      found.push(
        diagnostic(RULES.INW006, file, {
          span: ref,
          message: `Layer "${source.name}" imports "${ref.target}", which belongs to no layer, so nothing checks what "${pkg}" imports.`,
          fix: {
            summary: `Move the code into a layer, or ask the user which layer "${pkg}" belongs to.`,
            steps: [
              `If the code belongs to "${source.name}" or an inner layer, move it under that layer's package and import it from there.`,
              `Otherwise ask the user to add "${pkg}" to a layer in [tool.inwards]. Don't edit [tool.inwards] yourself.`,
            ],
          },
        }),
      );
    }
  }
  return found;
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
  return found;
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
 * ponytail: first quoted occurrence anywhere in the file; parse positions from TOML if this ever points wrong.
 *
 * @param text - the pyproject.toml text.
 * @param prefix - the prefix to find.
 * @returns the span of the string, or line 1 column 1 when it isn't spelled plainly.
 */
function spanOf(text: string, prefix: string): Span {
  const [at] = [`"${prefix}"`, `'${prefix}'`]
    .map((quoted) => text.indexOf(quoted))
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
