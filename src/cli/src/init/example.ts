/**
 * @file The example package `inwards init --style --scaffold` writes: an entity,
 * a port, a use case, an adapter, a driving adapter, the composition root and
 * one test, placed where the preset says, with a public `api` module in front
 * of them for the context presets (the Django app comes from `django.ts`). It
 * only builds file texts; planning where they land safely is `scaffold.ts`'s
 * job, and writing them is `InitFiles`'s.
 */
import { djangoModules } from "./django.ts";
import { type ExampleModules, expandLayers, type Style } from "./styles.ts";

/** Docstrings for packages the scaffold creates that are not a layer themselves. */
const PACKAGE_DOCS: Readonly<Record<string, string>> = {
  adapters: "Adapters: the code that connects the application to the outside world.",
  ports: "Ports: what the application needs from the outside, as typing.Protocol classes.",
  use_cases: "Use cases: what the application does, written against ports.",
  orders: "Orders: placing and storing orders, kept apart from the rest of the code.",
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
  const layers = expandLayers(style);
  const modules =
    style.example === undefined ? djangoModules(pkg) : exampleModules(style.example, pkg);
  // Every package on the way to a module, and each layer package the example leaves empty.
  const dirs = [
    ...[...modules.keys()].map((module) => module.split(".").slice(0, -1)),
    ...layers.filter((l) => !(l.file || l.module.includes("*"))).map((l) => l.module.split(".")),
  ];
  const packages = new Set([""]);
  for (const parts of dirs) {
    for (let end = 1; end <= parts.length; end += 1) {
      packages.add(parts.slice(0, end).join("."));
    }
  }
  const files = new Map<string, string>();
  for (const dir of [...packages].sort()) {
    const layer = layers.find((l) => matches(l.module, dir));
    const doc =
      layer === undefined
        ? PACKAGE_DOCS[dir.split(".").at(-1) ?? ""]
        : `The ${layer.name} layer: ${layer.role}.`;
    const path = dir === "" ? `${base}/__init__.py` : `${pathOf(base, dir)}/__init__.py`;
    files.set(path, doc === undefined ? "" : `"""${doc}"""\n`);
  }
  for (const [module, text] of modules) {
    files.set(`${pathOf(base, module)}.py`, text);
  }
  if (style.example !== undefined) {
    files.set("tests/test_place_order.py", exampleTest(style.example, pkg));
  }
  return files;
}

/**
 * Tells whether a module fills a layer's module pattern, where `*` stands for one segment.
 *
 * @param pattern - a layer's dotted module below the package, e.g. `*.domain`.
 * @param module - a dotted module below the package.
 * @returns true when every segment is equal or matched by `*`.
 */
function matches(pattern: string, module: string): boolean {
  const want = pattern.split(".");
  const got = module.split(".");
  return want.length === got.length && want.every((part, i) => part === "*" || part === got[i]);
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
 * Writes the imports of code outside the example's context: through its
 * public `api` module when it has one, else straight from each module.
 *
 * @param m - where each part of the example lives.
 * @param pkg - the package.
 * @param names - the names to import, keyed by the module that defines them.
 * @returns the import lines, sorted by module, one per module.
 */
function outsideImports(
  m: ExampleModules,
  pkg: string,
  names: readonly (readonly [string, string])[],
): string {
  const byModule = new Map<string, string[]>();
  for (const [module, name] of names) {
    const from = m.api ?? module;
    byModule.set(from, [...(byModule.get(from) ?? []), name]);
  }
  return imports(
    ...[...byModule].map(
      ([module, list]) => `from ${pkg}.${module} import ${list.sort().join(", ")}`,
    ),
  );
}

/**
 * Writes the public module of the example's context: it re-exports what the
 * composition root needs, so code outside imports nothing else (INW003).
 *
 * @param m - where each part of the example lives, `api` included.
 * @param pkg - the package.
 * @returns the module text.
 */
function apiModule(m: ExampleModules, pkg: string): string {
  return `"""The public module of this package: code outside it imports only this (INW003).

It re-exports what the composition root needs, so the modules behind it can change freely.
"""

from __future__ import annotations

${imports(
  `from ${pkg}.${m.adapter} import InMemoryOrderRepository`,
  `from ${pkg}.${m.driving} import run`,
  `from ${pkg}.${m.useCase} import PlaceOrder`,
)}

__all__ = ["InMemoryOrderRepository", "PlaceOrder", "run"]
`;
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
  const modules = new Map([
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

${outsideImports(m, pkg, [
  [m.adapter, "InMemoryOrderRepository"],
  [m.driving, "run"],
  [m.useCase, "PlaceOrder"],
])}


def main() -> int:
    """Builds the use case with its adapter and hands it to the command line."""
    return run(PlaceOrder(InMemoryOrderRepository()), sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
`,
    ],
  ]);
  if (m.api !== undefined) {
    modules.set(m.api, apiModule(m, pkg));
  }
  return modules;
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

${outsideImports(m, pkg, [
  [m.adapter, "InMemoryOrderRepository"],
  [m.useCase, "PlaceOrder"],
])}


def test_place_order_stores_the_order() -> None:
    orders = InMemoryOrderRepository()
    order = PlaceOrder(orders)("book", 2)
    assert orders.get(order.id) == order
`;
}
