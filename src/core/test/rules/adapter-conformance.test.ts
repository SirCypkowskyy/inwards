/**
 * @file INW020 `adapter-conformance` (#433, ADR-046): every public class of
 * an adapter module declares the port it implements with a conformance line,
 * `_: Port = Adapter(...)` or `_: type[Port] = Adapter`, in a module-level
 * `if TYPE_CHECKING:` block. A class without one is reported on its name, a
 * line outside the block on the line, and, with `ports` set, an annotation
 * that names no port on the annotation. Exceptions, enums, Pydantic models,
 * dataclasses, Protocols and private classes need no line. It is opt-in,
 * checks modules with an `adapters` segment unless `modules` says otherwise,
 * skips tests, and a suppression hides it.
 */
import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../../src/index.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "adapters", modules = ["shop.adapters"] },
]
`;

/** Where the checked adapter module lives unless a test says otherwise. */
const ADAPTER = "shop/adapters/orders.py";

/**
 * Checks one module with a rules table.
 *
 * @param text - the module's source.
 * @param rules - the rules table and any options tables, TOML.
 * @param path - where the module lives.
 * @returns every diagnostic.
 */
async function check(text: string, rules: string, path = ADAPTER): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(`${LAYERS}\n${rules}\n`));
  const files = new Map([[path, text]]);
  const kinds = new Map<string, "file" | "dir">([[path, "file"]]);
  return engine.checkFiles([file(path, text)], indexOn(kinds, files));
}

/**
 * Checks a module with INW020 on and keeps its findings.
 *
 * @param text - the module's source.
 * @param options - the `[tool.inwards.rules.adapter-conformance]` body, TOML.
 * @param path - where the module lives.
 * @returns `line:column message` for each INW020 finding.
 */
async function inw020(text: string, options = "", path = ADAPTER): Promise<string[]> {
  const table = options === "" ? "" : `[tool.inwards.rules.adapter-conformance]\n${options}\n`;
  const found = await check(
    text,
    `[tool.inwards.rules]\nextend-select = ["INW020"]\n${table}`,
    path,
  );
  return found.filter((d) => d.code === "INW020").map((d) => `${d.line}:${d.column} ${d.message}`);
}

const HEAD = `from typing import TYPE_CHECKING

from shop.application.ports.orders import OrderRepository


class SqlOrderRepository:
    def __init__(self, session) -> None:
        self._session = session

    def get(self, order_id: int):
        return self._session.get(order_id)
`;

const MISSING =
  "6:7 `SqlOrderRepository` in adapter module `shop.adapters.orders` declares no port it implements. Add `_: OrderRepository = SqlOrderRepository(...)` under `if TYPE_CHECKING:` at the end of the module, so the type checker checks the class against its port.";

describe("INW020 adapter-conformance", () => {
  test("is off by default", async () => {
    const found = await check(HEAD, "");
    expect(found.filter((d) => d.code === "INW020")).toEqual([]);
  });

  test("a class without a conformance line fails, on its name, naming the one imported port", async () => {
    expect(await inw020(HEAD)).toEqual([MISSING]);
  });

  test("the message says <Port> when the module imports no port, or more than one", async () => {
    const none = HEAD.replace("from shop.application.ports.orders import OrderRepository", "");
    const two = HEAD.replace("import OrderRepository", "import OrderReader, OrderWriter");
    const expected = MISSING.replace("`_: OrderRepository =", "`_: <Port> =");
    expect(await inw020(none)).toEqual([expected]);
    expect(await inw020(two)).toEqual([expected]);
  });

  test("the instance form and the class form under TYPE_CHECKING pass", async () => {
    const forms = [
      "_: OrderRepository = SqlOrderRepository(...)",
      "_: OrderRepository = SqlOrderRepository(session=None)",
      "_: OrderRepository = SqlOrderRepository[int](...)",
      "_: type[OrderRepository] = SqlOrderRepository",
      "_check: OrderRepository = SqlOrderRepository(...)",
    ];
    const found = await Promise.all(
      forms.map((line) => inw020(`${HEAD}\n\nif TYPE_CHECKING:\n    ${line}\n`)),
    );
    expect(found).toEqual(forms.map(() => []));
    const qualified = HEAD.replace("from typing import TYPE_CHECKING", "import typing");
    const text = `${qualified}\n\nif typing.TYPE_CHECKING:\n    _: OrderRepository = SqlOrderRepository(...)\n`;
    expect(await inw020(text)).toEqual([]);
  });

  test("a conformance line outside TYPE_CHECKING fails, on the line, and the class isn't reported again", async () => {
    const text = `${HEAD}\n\n_: OrderRepository = SqlOrderRepository(...)\n`;
    expect(await inw020(text)).toEqual([
      "14:1 `_: OrderRepository = SqlOrderRepository(...)` in adapter module `shop.adapters.orders` is outside `if TYPE_CHECKING:`, so it runs when the module is imported and builds a `SqlOrderRepository`. A conformance line is only for the type checker.",
    ]);
    const typed = `${HEAD}\n\n_: type[OrderRepository] = SqlOrderRepository\n`;
    expect(await inw020(typed)).toEqual([
      "14:1 `_: type[OrderRepository] = SqlOrderRepository` in adapter module `shop.adapters.orders` is outside `if TYPE_CHECKING:`, so it runs when the module is imported and needs the port imported at runtime. A conformance line is only for the type checker.",
    ]);
  });

  test("an else branch of TYPE_CHECKING runs, so a line there fails", async () => {
    const text = `${HEAD}\n\nif TYPE_CHECKING:\n    pass\nelse:\n    _: OrderRepository = SqlOrderRepository(...)\n`;
    const found = await inw020(text);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("is outside `if TYPE_CHECKING:`");
  });

  test("with ports set, an annotation that names no port fails, on the annotation", async () => {
    const text = `${HEAD}from shop.domain.orders import Order\n\nif TYPE_CHECKING:\n    _: Order = SqlOrderRepository(...)\n`;
    expect(await inw020(text, 'ports = ["shop.application.ports"]')).toEqual([
      "15:8 The conformance line for `SqlOrderRepository` in adapter module `shop.adapters.orders` is annotated `shop.domain.orders.Order`, which isn't a class from a port module (`ports`), so the type checker doesn't check the class against a port.",
    ]);
    const ok = `${HEAD}\n\nif TYPE_CHECKING:\n    _: type[OrderRepository] = SqlOrderRepository\n`;
    expect(await inw020(ok, 'ports = ["shop.application.ports"]')).toEqual([]);
  });

  test("without ports, any annotation counts but Any and object", async () => {
    const other = `${HEAD}from shop.domain.orders import Order\n\nif TYPE_CHECKING:\n    _: Order = SqlOrderRepository(...)\n`;
    expect(await inw020(other)).toEqual([]);
    const any = `${HEAD}from typing import Any\n\nif TYPE_CHECKING:\n    _: Any = SqlOrderRepository(...)\n    __: object = SqlOrderRepository(...)\n`;
    expect(await inw020(any)).toEqual([
      "15:8 The conformance line for `SqlOrderRepository` in adapter module `shop.adapters.orders` is annotated `typing.Any`, which accepts any value, so the type checker doesn't check the class against a port.",
      "16:9 The conformance line for `SqlOrderRepository` in adapter module `shop.adapters.orders` is annotated `object`, which accepts any value, so the type checker doesn't check the class against a port.",
    ]);
  });

  test("exceptions, enums, models, dataclasses, Protocols, ABCs and private classes need no line", async () => {
    const text = `import abc
import enum
from dataclasses import dataclass
from typing import NamedTuple, Protocol

from pydantic import BaseModel

from shop.domain.errors import DomainError


class StorageError(DomainError):
    pass


class Status(enum.Enum):
    OK = 1


class Row(BaseModel):
    id: int


class Pair(NamedTuple):
    a: int


@dataclass(frozen=True)
class Page:
    items: list


class Source(Protocol):
    def read(self) -> bytes: ...


class Base(abc.ABC):
    pass


class _Helper:
    pass


class RowError(StorageError):
    pass
`;
    expect(await inw020(text)).toEqual([]);
  });

  test("allow-bases replaces the default, extend-allow-bases adds to it, allow-decorators replaces decorators", async () => {
    const text = `from shop.kit import Schema


class Cursor(Schema):
    pass
`;
    expect(await inw020(text)).toHaveLength(1);
    expect(await inw020(text, 'extend-allow-bases = ["shop.kit.Schema"]')).toEqual([]);
    const error = "class FooError(Exception):\n    pass\n";
    expect(await inw020(error, 'allow-bases = ["shop.kit.Schema"]')).toHaveLength(1);
    const record = "from attrs import define\n\n\n@define\nclass Row:\n    pass\n";
    expect(await inw020(record)).toEqual([]);
    expect(await inw020(record, 'allow-decorators = ["dataclasses.dataclass"]')).toHaveLength(1);
  });

  test("only modules with an adapters segment are checked unless modules is set", async () => {
    expect(await inw020(HEAD, "", "shop/infrastructure/orders.py")).toEqual([]);
    const scoped = await inw020(
      HEAD,
      'modules = ["shop.infrastructure"]',
      "shop/infrastructure/orders.py",
    );
    expect(scoped).toHaveLength(1);
    expect(await inw020(HEAD, 'modules = ["shop.infrastructure"]')).toEqual([]);
  });

  test("with ports set, the message's port comes from those modules", async () => {
    const text = HEAD.replace("shop.application.ports.orders", "shop.application.contracts");
    expect(await inw020(text)).toEqual([MISSING.replace("`_: OrderRepository =", "`_: <Port> =")]);
    expect(await inw020(text, 'ports = ["shop.application.contracts"]')).toEqual([MISSING]);
  });

  test("tests are skipped unless check-tests is set", async () => {
    const path = "tests/adapters/test_orders.py";
    expect(await inw020(HEAD, "", path)).toEqual([]);
    expect(await inw020(HEAD, "check-tests = true", path)).toHaveLength(1);
  });

  test("a file without class is not parsed for it, and nested classes don't count", async () => {
    expect(await inw020("def build():\n    return 1\n")).toEqual([]);
    const nested = "def make():\n    class Local:\n        pass\n    return Local\n";
    expect(await inw020(nested)).toEqual([]);
  });

  test("the fix says how to add the line, or how to mark a helper", async () => {
    const found = await check(HEAD, '[tool.inwards.rules]\nextend-select = ["INW020"]');
    const [finding] = found.filter((d) => d.code === "INW020");
    expect(finding?.fix).toMatchSnapshot();
  });

  test("an inline suppression hides it", async () => {
    const text = HEAD.replace(
      "class SqlOrderRepository:",
      'class SqlOrderRepository:  # inwards: ignore[INW020] reason="legacy adapter, port pending"',
    );
    expect(await inw020(text)).toEqual([]);
  });
});
