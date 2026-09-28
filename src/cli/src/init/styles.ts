/**
 * @file What an `inwards init --style` preset is: its layers innermost first
 * (sibling groups and templates included), templates, contexts, example
 * modules and shapes, as types, plus the helpers that read a preset, such as
 * expanding its templates into layers the way the config parser does. The
 * presets themselves are `presets.ts`'s, and their text is `style-text.ts`'s.
 */
import type { StyleShape } from "./shapes.ts";

export const STYLE_NAMES = [
  "layered",
  "clean",
  "hexagonal",
  "vertical-slices",
  "bounded-contexts",
  "django",
] as const;
export type StyleName = (typeof STYLE_NAMES)[number];

/** One layer entry of a preset, as the config writes it. */
export interface StyleLayer {
  name: string;
  /** Dotted module below the project package, e.g. `adapters.inbound`; "" is the package itself, `*` one package below it. */
  module: string;
  role: string;
  /** A module rather than a package, so the tree draws `name.py`. */
  file?: true;
  /** Shares the previous layer's place: siblings may not import each other (ADR-036). */
  sibling?: true;
  /** A template of the preset whose roles become the layers inside this entry's modules. */
  template?: string;
  /** Written as `deny-libraries`; `[]` lifts INW005's default for the innermost layer. */
  denyLibraries?: readonly string[];
}

/** One role of a template: a module name inside each package the template covers. */
interface StyleRole {
  name: string;
  role: string;
  file?: true;
}

/** A `[tool.inwards.templates.<name>]` a preset writes. */
export interface StyleTemplate {
  name: string;
  /** The comment above the table. */
  why: string;
  roles: readonly StyleRole[];
  /** Module names inside each context that other code may import (INW003). */
  public: readonly string[];
}

/** The preset's contexts (INW002, INW003): one per package that repeats the template. */
export interface StyleContexts {
  /** The template each context names. */
  template: string;
  /** Where the contexts live, e.g. `features`: each is one package below it. */
  parent: string;
  /** The comment above the entries, one line each. */
  why: readonly string[];
  /** The scaffold's contexts, by package name below `parent`. */
  names: readonly string[];
}

/** Where the scaffold puts each part of the order example, as dotted modules below the package. */
export interface ExampleModules {
  entity: string;
  port: string;
  useCase: string;
  adapter: string;
  driving: string;
  bootstrap: string;
  /** A context's public module, which re-exports what the composition root needs (INW003). */
  api?: string;
}

/** A preset: a one-line summary, its config, the example's modules, its shapes, and the import it can't forbid. */
export interface Style {
  name: StyleName;
  summary: string;
  layers: readonly StyleLayer[];
  templates: readonly StyleTemplate[];
  contexts: StyleContexts | undefined;
  /** Rules the preset turns off, and why, for `[tool.inwards.rules]`. */
  ignoreRules: { codes: readonly string[]; why: string } | undefined;
  /** The order example's modules, or undefined for the Django app example (`django.ts`). */
  example: ExampleModules | undefined;
  /** What to run to try the scaffold, for the package given. */
  tryIt: (pkg: string) => string;
  shapes: readonly StyleShape[];
  gap: string;
}

/** A layer as the config expands it: templates become one layer per role, with its rank. */
export interface ExpandedLayer {
  name: string;
  module: string;
  role: string;
  file: boolean;
  /** Its place in the order; siblings share one. */
  rank: number;
}

export const BOOTSTRAP: StyleLayer = {
  name: "bootstrap",
  module: "bootstrap",
  role: "composition root: wires the adapters into the use cases",
  file: true,
};

/**
 * Words the next step for the order example: run its composition root.
 *
 * @param pkg - the project's import package.
 * @returns the command.
 */
export function runBootstrap(pkg: string): string {
  return `uv run python -m ${pkg}.bootstrap book 2`;
}

/**
 * Tells whether a string names a preset.
 *
 * @param value - what was passed to `--style`, if anything.
 * @returns true for one of {@link STYLE_NAMES}.
 */
export function isStyle(value: string | undefined): value is StyleName {
  return STYLE_NAMES.some((name) => name === value);
}

/**
 * Expands a preset's layers the way the config parser does: an entry with a
 * template becomes one layer per role, named `<entry>.<role>`, and a sibling
 * shares the rank of the layer before it.
 *
 * @param style - the preset.
 * @returns the layers innermost first, with modules below the package.
 */
export function expandLayers(style: Style): ExpandedLayer[] {
  const out: ExpandedLayer[] = [];
  let rank = -1;
  for (const layer of style.layers) {
    const template = style.templates.find((t) => t.name === layer.template);
    if (template === undefined) {
      rank += layer.sibling === true ? 0 : 1;
      out.push({ ...layer, file: layer.file === true, rank });
      continue;
    }
    for (const role of template.roles) {
      rank += 1;
      out.push({
        name: `${layer.name}.${role.name}`,
        module: layer.module === "" ? role.name : `${layer.module}.${role.name}`,
        role: role.role,
        file: role.file === true,
        rank,
      });
    }
  }
  return out;
}

/**
 * Says what one layer may import, as the annotated tree, `--list-styles` and
 * the architecture brief show it: every layer of a lower rank, and, with
 * sibling layers (ADR-036), which siblings are off limits.
 *
 * @param layers - the layers innermost first; a layer without a rank ranks by its index.
 * @param i - the layer's index.
 * @returns e.g. `may import domain`, `imports no other layer; not its sibling inbound`, or `may import every other layer`.
 */
export function allowedImports(
  layers: readonly { name: string; rank?: number | undefined }[],
  i: number,
): string {
  /**
   * Finds a layer's place in the order.
   *
   * @param k - the layer's index.
   * @returns its rank, or its index when the layers have no ranks.
   */
  function rankOf(k: number): number {
    return layers[k]?.rank ?? k;
  }
  const rank = rankOf(i);
  const inner = layers.filter((_, k) => rankOf(k) < rank).map((layer) => layer.name);
  const siblings = layers.filter((_, k) => k !== i && rankOf(k) === rank).map((l) => l.name);
  let base = `may import ${inner.join(", ")}`;
  if (inner.length === 0) {
    base = "imports no other layer";
  } else if (siblings.length === 0 && inner.length === layers.length - 1) {
    base = "may import every other layer";
  }
  const plural = siblings.length > 1 ? "siblings" : "sibling";
  return siblings.length === 0 ? base : `${base}; not its ${plural} ${siblings.join(", ")}`;
}
