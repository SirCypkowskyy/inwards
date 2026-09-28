/**
 * @file The architecture presets behind `inwards init --style`: each one's layers,
 * innermost first, and the example package `--scaffold` writes for it. A
 * preset only uses what a layer-only config can express, so each names the
 * one import its layers can't forbid (its `gap`).
 */

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
interface ExampleModules {
  entity: string;
  port: string;
  useCase: string;
  adapter: string;
  driving: string;
  bootstrap: string;
}

/** A preset: a one-line summary, the layers, the example's modules, and the import it can't forbid. */
export interface Style {
  name: StyleName;
  summary: string;
  layers: readonly StyleLayer[];
  example: ExampleModules;
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
    return [`${name}: ${style.summary}`, ...rows, `  Gap: ${style.gap}.`].join("\n");
  }).join("\n\n");
}

/**
 * Builds the `[tool.inwards]` table a preset writes, with a comment naming
 * the preset and the version, and one comment per layer saying what goes in it.
 *
 * @param style - the preset.
 * @param opts - the package, the config root, this release, the ignore list and the line ending.
 * @param opts.pkg - the project's import package, e.g. `my_app`.
 * @param opts.root - the config root, `src` or `.`.
 * @param opts.version - this release, for `required-version` and the comment.
 * @param opts.ignore - the `ignore` entries.
 * @param opts.eol - the file's line ending.
 * @returns the table's text, ending with a line break.
 */
export function configTable(
  style: Style,
  opts: { pkg: string; root: string; version: string; ignore: readonly string[]; eol: string },
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
  ];
  return `${lines.join(opts.eol)}${opts.eol}`;
}

/** Docstrings for packages the scaffold creates that are not a layer themselves. */
const PACKAGE_DOCS: Readonly<Record<string, string>> = {
  adapters: "Adapters: the code that connects the application to the outside world.",
  ports: "Ports: what the application needs from the outside, as typing.Protocol classes.",
  use_cases: "Use cases: what the application does, written against ports.",
};

/**
 * Lists the files `--scaffold` writes for a preset: the example modules, an
 * `__init__.py` with a docstring for every package on the way, and one test.
 * Paths are relative to the project directory, with forward slashes.
 *
 * @param style - the preset.
 * @param pkg - the project's import package, e.g. `my_app`.
 * @param root - the config root, `src` or `.`.
 * @returns the file texts keyed by relative path, the package's own `__init__.py` included.
 */
export function scaffoldFiles(style: Style, pkg: string, root: string): Map<string, string> {
  const base = [...(root === "." ? [] : root.split("/")), ...pkg.split(".")].join("/");
  const files = new Map<string, string>();
  const layerDocs = new Map(
    style.layers.map((layer) => [layer.module, `The ${layer.name} layer: ${layer.role}.`]),
  );
  for (const [module, text] of exampleModules(style.example, pkg)) {
    const parts = module.split(".");
    for (let end = 0; end < parts.length; end += 1) {
      const dir = parts.slice(0, end).join(".");
      const doc = layerDocs.get(dir) ?? PACKAGE_DOCS[parts[end - 1] ?? ""];
      const path = end === 0 ? `${base}/__init__.py` : `${pathOf(base, dir)}/__init__.py`;
      files.set(path, doc === undefined ? "" : `"""${doc}"""\n`);
    }
    files.set(`${pathOf(base, module)}.py`, text);
  }
  files.set("tests/test_place_order.py", exampleTest(style.example, pkg));
  return files;
}

/**
 * Turns a dotted module below the package into a relative path.
 *
 * @param base - the package's directory, relative to the project.
 * @param module - a dotted module below the package.
 * @returns the path, without an extension.
 */
function pathOf(base: string, module: string): string {
  return `${base}/${module.replaceAll(".", "/")}`;
}

/**
 * Sorts `from X import Y` lines the way isort and Ruff do, by module.
 *
 * @param lines - import lines.
 * @returns them sorted, joined with line breaks.
 */
function imports(...lines: string[]): string {
  return lines.sort().join("\n");
}

/**
 * Writes the example's Python modules: an entity, a port, a use case, an
 * adapter implementing the port, a driving adapter and the composition root.
 *
 * @param m - where each part goes, below the package.
 * @param pkg - the package.
 * @returns module text keyed by dotted module below the package.
 */
function exampleModules(m: ExampleModules, pkg: string): Map<string, string> {
  const future = "from __future__ import annotations\n";
  return new Map([
    [
      m.entity,
      `"""Order, an entity: business data and rules, with no I/O and no framework."""

${future}
from dataclasses import dataclass


@dataclass(frozen=True)
class Order:
    """An order for some quantity of one item."""

    id: str
    item: str
    quantity: int

    def __post_init__(self) -> None:
        if self.quantity < 1:
            msg = "an order needs a quantity of at least 1"
            raise ValueError(msg)
`,
    ],
    [
      m.port,
      `"""OrderRepository, a port: what the use cases need from storage, as a Protocol."""

${future}
from typing import Protocol

from ${pkg}.${m.entity} import Order


class OrderRepository(Protocol):
    """Stores orders. An adapter implements it; the use cases depend only on it."""

    def add(self, order: Order) -> None:
        """Saves an order."""
        ...

    def get(self, order_id: str) -> Order | None:
        """Returns the order with this id, or None."""
        ...
`,
    ],
    [
      m.useCase,
      `"""PlaceOrder, a use case: one thing the application does, written against a port."""

${future}
from uuid import uuid4

${imports(`from ${pkg}.${m.entity} import Order`, `from ${pkg}.${m.port} import OrderRepository`)}


class PlaceOrder:
    """Creates an order and stores it."""

    def __init__(self, orders: OrderRepository) -> None:
        self._orders = orders

    def __call__(self, item: str, quantity: int) -> Order:
        order = Order(id=uuid4().hex, item=item, quantity=quantity)
        self._orders.add(order)
        return order
`,
    ],
    [
      m.adapter,
      `"""InMemoryOrderRepository, an adapter: implements the OrderRepository port with a dict.

Replace it with a database adapter and the use case doesn't change.
"""

${future}
${imports(`from ${pkg}.${m.entity} import Order`, `from ${pkg}.${m.port} import OrderRepository`)}


class InMemoryOrderRepository(OrderRepository):
    """Keeps orders in memory, for tests and demos."""

    def __init__(self) -> None:
        self._orders: dict[str, Order] = {}

    def add(self, order: Order) -> None:
        self._orders[order.id] = order

    def get(self, order_id: str) -> Order | None:
        return self._orders.get(order_id)
`,
    ],
    [
      m.driving,
      `"""The command line, a driving adapter: turns arguments into a use case call."""

${future}
import argparse

from ${pkg}.${m.useCase} import PlaceOrder


def run(place_order: PlaceOrder, argv: list[str]) -> int:
    """Places the order that argv describes and prints it."""
    parser = argparse.ArgumentParser(prog="place-order", description="Place an order.")
    parser.add_argument("item")
    parser.add_argument("quantity", type=int)
    args = parser.parse_args(argv)
    order = place_order(args.item, args.quantity)
    print(f"Placed order {order.id}: {order.quantity} x {order.item}")
    return 0
`,
    ],
    [
      m.bootstrap,
      `"""The composition root: the one module that sees every layer and wires them together.

Run it with \`python -m ${pkg}.${m.bootstrap} book 2\`.
"""

${future}
import sys

${imports(
  `from ${pkg}.${m.adapter} import InMemoryOrderRepository`,
  `from ${pkg}.${m.driving} import run`,
  `from ${pkg}.${m.useCase} import PlaceOrder`,
)}


def main() -> int:
    """Builds the use case with its adapter and hands it to the command line."""
    return run(PlaceOrder(InMemoryOrderRepository()), sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
`,
    ],
  ]);
}

/**
 * Writes the example's one test: the use case against the in-memory adapter.
 *
 * @param m - where each part of the example lives.
 * @param pkg - the package.
 * @returns the test module's text.
 */
function exampleTest(m: ExampleModules, pkg: string): string {
  return `"""The use case runs against the in-memory adapter: no database needed."""

from __future__ import annotations

${imports(
  `from ${pkg}.${m.adapter} import InMemoryOrderRepository`,
  `from ${pkg}.${m.useCase} import PlaceOrder`,
)}


def test_place_order_stores_the_order() -> None:
    orders = InMemoryOrderRepository()
    order = PlaceOrder(orders)("book", 2)
    assert orders.get(order.id) == order
`;
}
