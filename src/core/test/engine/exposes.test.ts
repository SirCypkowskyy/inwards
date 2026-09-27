/**
 * @file `ProjectIndex.exposes`, which INW003's fix uses to name the public
 * module a name can be imported from. A module exposes a name it defines at
 * its top level (`def`, `async def`, `class`, an assignment) or imports; an
 * aliased import, a comparison, a nested definition, a missing module and a
 * name that isn't an identifier don't count.
 */
import { expect, test } from "bun:test";
import { indexOn } from "../support/helpers.ts";

const API = [
  "from shop.billing.charge import refund",
  "import shop.billing.tax as rates",
  "",
  "",
  "def total(order_id: int) -> int:",
  "    def inner() -> None: ...",
  "    return 0",
  "",
  "",
  "async def fetch() -> None: ...",
  "",
  "",
  "class Invoice:",
  "    pass",
  "",
  "",
  "RATE: float = 0.2",
  "LIMIT = 10",
  "LIMIT == 11",
  "",
].join("\n");

const INDEX = indexOn(
  new Map<string, "file" | "dir">([
    ["shop", "dir"],
    ["shop/__init__.py", "file"],
    ["shop/billing", "dir"],
    ["shop/billing/__init__.py", "file"],
    ["shop/billing/api.py", "file"],
  ]),
  new Map([
    ["shop/billing/api.py", API],
    ["shop/billing/__init__.py", "from shop.billing.api import Invoice\n"],
  ]),
);

test("top-level definitions and imports are exposed", () => {
  for (const name of ["refund", "total", "fetch", "Invoice", "RATE", "LIMIT"]) {
    expect([name, INDEX.exposes("shop.billing.api", name)]).toEqual([name, true]);
  }
});

test("a package exposes what its __init__.py imports", () => {
  expect(INDEX.exposes("shop.billing", "Invoice")).toBe(true);
  expect(INDEX.exposes("shop.billing", "total")).toBe(false);
});

test("aliases, nested definitions, other names and missing modules don't count", () => {
  expect(INDEX.exposes("shop.billing.api", "tax")).toBe(false);
  expect(INDEX.exposes("shop.billing.api", "inner")).toBe(false);
  expect(INDEX.exposes("shop.billing.api", "Missing")).toBe(false);
  expect(INDEX.exposes("shop.billing.gone", "total")).toBe(false);
  expect(INDEX.exposes("shop.billing.api", "RATE.x")).toBe(false);
  expect(INDEX.exposes("shop.billing.api", "(.*)")).toBe(false);
});
