/**
 * @file The architecture presets behind `inwards init --style`: each one's layers,
 * innermost first, where `--scaffold` puts each part of its example, and the
 * package shapes (INW007, INW008) that go with the scaffold. A preset only
 * uses what a layer-only config can express, so each names the one import
 * its layers can't forbid (its `gap`).
 */
import {
  ADAPTERS,
  describeShapes,
  type StyleShape,
  shapeLines,
  topShape,
  USE_CASES,
} from "./shapes.ts";

export const STYLE_NAMES = ["layered", "clean", "hexagonal"] as const;
export type StyleName = (typeof STYLE_NAMES)[number];

/** One layer of a preset: its name, its module below the package, and what goes in it. */
interface StyleLayer {
  name: string;
  /** Dotted module below the project package, e.g. `adapters.inbound`. */
  module: string;
  role: string;
}

/** Where the scaffold puts each part of the example, as dotted modules below the package. */
export interface ExampleModules {
  entity: string;
  port: string;
  useCase: string;
  adapter: string;
  driving: string;
  bootstrap: string;
}

/** A preset: a one-line summary, the layers, the example's modules, its shapes, and the import it can't forbid. */
export interface Style {
  name: StyleName;
  summary: string;
  layers: readonly StyleLayer[];
  example: ExampleModules;
  shapes: readonly StyleShape[];
  gap: string;
}

const BOOTSTRAP: StyleLayer = {
  name: "bootstrap",
  module: "bootstrap",
  role: "composition root: wires the adapters into the use cases",
};

export const STYLES: Readonly<Record<StyleName, Style>> = {
  layered: {
    name: "layered",
    summary: "N-tier: presentation calls services, services call persistence",
    layers: [
      { name: "domain", module: "domain", role: "entities shared by every layer" },
      { name: "persistence", module: "persistence", role: "repositories and their Protocols" },
      { name: "services", module: "services", role: "business operations (use cases)" },
      { name: "presentation", module: "presentation", role: "CLI or HTTP handlers" },
      BOOTSTRAP,
    ],
    example: {
      entity: "domain.order",
      port: "persistence.orders",
      useCase: "services.place_order",
      adapter: "persistence.in_memory_orders",
      driving: "presentation.cli",
      bootstrap: "bootstrap",
    },
    shapes: [topShape(["domain/", "persistence/", "services/", "presentation/"])],
    gap: "presentation may call persistence without going through services (open layers)",
  },
  clean: {
    name: "clean",
    summary: "entities at the centre, use cases around them, frameworks outside",
    layers: [
      { name: "domain", module: "domain", role: "entities and business rules, no I/O" },
      { name: "application", module: "application", role: "use cases and the ports they need" },
      { name: "infrastructure", module: "infrastructure", role: "adapters that implement ports" },
      { name: "presentation", module: "presentation", role: "CLI or HTTP handlers" },
      BOOTSTRAP,
    ],
    example: {
      entity: "domain.order",
      port: "application.ports.orders",
      useCase: "application.use_cases.place_order",
      adapter: "infrastructure.in_memory_orders",
      driving: "presentation.cli",
      bootstrap: "bootstrap",
    },
    shapes: [topShape(["domain/", "application/", "infrastructure/", "presentation/"]), USE_CASES],
    gap: "presentation may import infrastructure; leave the wiring to bootstrap",
  },
  hexagonal: {
    name: "hexagonal",
    summary: "ports and adapters: the application talks to the world only through ports",
    layers: [
      { name: "domain", module: "domain", role: "entities and business rules, no I/O" },
      { name: "application", module: "application", role: "use cases and the ports they need" },
      { name: "outbound", module: "adapters.outbound", role: "driven adapters: implement ports" },
      { name: "inbound", module: "adapters.inbound", role: "driving adapters: call use cases" },
      BOOTSTRAP,
    ],
    example: {
      entity: "domain.order",
      port: "application.ports.orders",
      useCase: "application.use_cases.place_order",
      adapter: "adapters.outbound.in_memory_orders",
      driving: "adapters.inbound.cli",
      bootstrap: "bootstrap",
    },
    shapes: [topShape(["domain/", "application/", "adapters/"]), USE_CASES, ADAPTERS],
    gap: "inbound adapters may import outbound ones; leave the wiring to bootstrap",
  },
};

/**
 * Tells whether a string names a preset.
 *
 * @param value - what was passed to `--style`, if anything.
 * @returns true for layered, clean or hexagonal.
 */
export function isStyle(value: string | undefined): value is StyleName {
  return STYLE_NAMES.some((name) => name === value);
}

/**
 * Says what one layer may import, innermost first, as the annotated tree and
 * the architecture brief show it.
 *
 * @param names - the layer names, innermost first.
 * @param index - the layer's position in `names`.
 * @returns e.g. `may import domain, application`, `imports no other layer`, or for the outermost `may import every other layer`.
 */
export function allowedImports(names: readonly string[], index: number): string {
  const inner = names.slice(0, index);
  if (inner.length === 0) {
    return "imports no other layer";
  }
  return index === names.length - 1
    ? "may import every other layer"
    : `may import ${inner.join(", ")}`;
}

export const MISSING = "(missing)";

/** What a module below the package is on disk, for the tree. */
export type ModuleKind = "file" | "dir" | "missing";

/** One node of the tree: a package or module, and the layer it is, if any. */
interface TreeNode {
  children: Map<string, TreeNode>;
  layer: number | undefined;
}

/**
 * Draws a preset's layer packages as a tree, each with its layer and what it
 * may import, e.g. `├── domain/   domain: imports no other layer`. Used after
 * init writes (with what is on disk) and in the picker (with what the scaffold
 * would create).
 *
 * @param style - the preset.
 * @param header - the first line, e.g. `src/app/  (hexagonal)`.
 * @param kind - tells what a module is, from its name segments below the package.
 * @returns the tree as lines of text, each layer annotated.
 */
export function drawTree(
  style: Style,
  header: string,
  kind: (parts: readonly string[]) => ModuleKind,
): string {
  const top: TreeNode = { children: new Map(), layer: undefined };
  style.layers.forEach((layer, index) => {
    let node = top;
    for (const part of layer.module.split(".")) {
      const child = node.children.get(part) ?? { children: new Map(), layer: undefined };
      node.children.set(part, child);
      node = child;
    }
    node.layer = index;
  });
  const rows: [string, string][] = [];
  /**
   * Adds one node's children as rows, depth first, in name order.
   *
   * @param node - the package whose children to add.
   * @param parts - its name segments below the package.
   * @param indent - the tree lines drawn to its left.
   */
  function walk(node: TreeNode, parts: readonly string[], indent: string): void {
    const children = [...node.children].sort(([a], [b]) => a.localeCompare(b));
    children.forEach(([name, child], i) => {
      const last = i === children.length - 1;
      const what = kind([...parts, name]);
      // A missing module is drawn the way the scaffold would create it.
      const file =
        what === "file" ||
        (what === "missing" && [...parts, name].join(".") === style.example.bootstrap);
      const label = `${indent}${last ? "└── " : "├── "}${file ? `${name}.py` : `${name}/`}`;
      rows.push([label, layerNote(style, child.layer, what !== "missing")]);
      walk(child, [...parts, name], `${indent}${last ? "    " : "│   "}`);
    });
  }
  walk(top, [], "");
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, note]) =>
    note === "" ? label : `${label.padEnd(width)}  ${note}`,
  );
  return [header, ...lines].join("\n");
}

/**
 * Words the note next to a layer in the tree.
 *
 * @param style - the preset.
 * @param index - the node's layer, or undefined for a package that only holds layers.
 * @param exists - whether the layer's package or module is on disk.
 * @returns e.g. `application: may import domain`, or "" for a non-layer package.
 */
function layerNote(style: Style, index: number | undefined, exists: boolean): string {
  const layer = index === undefined ? undefined : style.layers[index];
  if (layer === undefined || index === undefined) {
    return "";
  }
  return `${layer.name}: ${allowedImports(
    style.layers.map((l) => l.name),
    index,
  )}${exists ? "" : ` ${MISSING}`}`;
}

/**
 * Prints every preset's layers for `inwards init --list-styles`.
 *
 * @param pkg - the package name to show in module names.
 * @returns the text, one block per preset.
 */
export function describeStyles(pkg: string): string {
  return STYLE_NAMES.map((name) => {
    const style = STYLES[name];
    const width = Math.max(...style.layers.map((layer) => layer.name.length));
    const modWidth = Math.max(...style.layers.map((layer) => `${pkg}.${layer.module}`.length));
    const rows = style.layers.map(
      (layer, i) =>
        `  ${i + 1}. ${layer.name.padEnd(width)}  ${`${pkg}.${layer.module}`.padEnd(modWidth)}  ${layer.role}`,
    );
    return [
      `${name}: ${style.summary}`,
      ...rows,
      `  Gap: ${style.gap}.`,
      "  Shapes, with --scaffold:",
      ...describeShapes(style.shapes, pkg),
    ].join("\n");
  }).join("\n\n");
}

/**
 * Builds the `[tool.inwards]` table a preset writes, with a comment naming
 * the preset and the version, and one comment per layer saying what goes in
 * it, followed by the preset's shapes when the scaffold is written too.
 *
 * @param style - the preset.
 * @param opts - the package, the config root, this release, the ignore list, the shapes switch and the line ending.
 * @param opts.pkg - the project's import package, e.g. `my_app`.
 * @param opts.root - the config root, `src` or `.`.
 * @param opts.version - this release, for `required-version` and the comment.
 * @param opts.ignore - the `ignore` entries.
 * @param opts.shapes - whether to add the preset's `[[tool.inwards.shape]]` entries (with `--scaffold`).
 * @param opts.eol - the file's line ending.
 * @returns the table's text, ending with a line break.
 */
export function configTable(
  style: Style,
  opts: {
    pkg: string;
    root: string;
    version: string;
    ignore: readonly string[];
    shapes: boolean;
    eol: string;
  },
): string {
  const entries = style.layers.map(
    (layer) =>
      `{ name = ${JSON.stringify(layer.name)}, modules = [${JSON.stringify(`${opts.pkg}.${layer.module}`)}] },`,
  );
  const width = Math.max(...entries.map((entry) => entry.length));
  const lines = [
    "[tool.inwards]",
    `# Preset "${style.name}" (inwards init --style ${style.name}, Inwards ${opts.version}).`,
    "# Layers are listed innermost first: each may import itself and the layers above it.",
    `# Not enforced by this preset: ${style.gap}.`,
    `root = ${JSON.stringify(opts.root)}`,
    `required-version = ${JSON.stringify(opts.version)}`,
    `ignore = [${opts.ignore.map((entry) => JSON.stringify(entry)).join(", ")}]`,
    "layers = [",
    ...style.layers.map((layer, i) => `  ${(entries[i] ?? "").padEnd(width)}  # ${layer.role}`),
    "]",
    ...(opts.shapes ? shapeLines(style.shapes, opts.pkg) : []),
  ];
  return `${lines.join(opts.eol)}${opts.eol}`;
}
