/**
 * @file `ProjectIndex.exposes`, which INW003's fix uses to name the public
 * module a name can be imported from. A module exposes the names it binds
 * at its top level, read from its syntax tree: definitions, decorated ones
 * included, assignments with a value, and imports under their `as` name. A
 * function's local import, a `TYPE_CHECKING` block, a string, an annotation
 * without a value and a renamed import's original name don't count; neither
 * do a missing module or a name that isn't an identifier. A `.pyi` stub is
 * read when there is no `.py`.
 */
import { expect, test } from "bun:test";
import { indexOn } from "../support/helpers.ts";

const API = `from typing import TYPE_CHECKING

from shop.billing.charge import refund
from shop.billing.tax import (
    rate
    as tax_rate,
)
import shop.billing.money as cash
import json

if TYPE_CHECKING:
    from shop.billing.charge import Receipt


@staticmethod
def total(order_id: int) -> int:
    from shop.billing.charge import local_only
    return 0


async def fetch() -> None: ...


class Invoice:
    nested = 1


RATE: float = 0.2
LIMIT = COUNT = 10
PENDING: int
LIMIT == 11
TEXT = """
def hidden(): ...
from shop.billing.charge import quoted
"""
`;

const INDEX = indexOn(
  new Map<string, "file" | "dir">([
    ["shop", "dir"],
    ["shop/__init__.py", "file"],
    ["shop/billing", "dir"],
    ["shop/billing/__init__.py", "file"],
    ["shop/billing/api.py", "file"],
    ["shop/billing/stubbed.pyi", "file"],
  ]),
  new Map([
    ["shop/billing/api.py", API],
    ["shop/billing/__init__.py", "from shop.billing.api import Invoice\n"],
    ["shop/billing/stubbed.pyi", "def charged(amount: int) -> None: ...\n"],
  ]),
);

test("what a module binds at its top level is exposed", () => {
  const bound = ["refund", "tax_rate", "cash", "json", "total", "fetch", "Invoice", "RATE"];
  for (const name of [...bound, "LIMIT", "COUNT", "TEXT", "TYPE_CHECKING"]) {
    expect([name, INDEX.exposes("shop.billing.api", name)]).toEqual([name, true]);
  }
});

test("what it doesn't bind at its top level isn't", () => {
  const unbound = ["rate", "money", "Receipt", "local_only", "nested", "PENDING", "hidden"];
  for (const name of [...unbound, "quoted", "Missing"]) {
    expect([name, INDEX.exposes("shop.billing.api", name)]).toEqual([name, false]);
  }
});

test("a package exposes what its __init__.py binds, and a stub what it declares", () => {
  expect(INDEX.exposes("shop.billing", "Invoice")).toBe(true);
  expect(INDEX.exposes("shop.billing", "total")).toBe(false);
  expect(INDEX.exposes("shop.billing.stubbed", "charged")).toBe(true);
});

test("a missing module and a name that isn't an identifier expose nothing", () => {
  expect(INDEX.exposes("shop.billing.gone", "total")).toBe(false);
  expect(INDEX.exposes("shop.billing.api", "RATE.x")).toBe(false);
  expect(INDEX.exposes("shop.billing.api", "(.*)")).toBe(false);
});
