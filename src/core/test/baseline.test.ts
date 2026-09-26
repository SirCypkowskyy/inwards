import { describe, expect, test } from "bun:test";
import { baselineKey } from "../src/index.ts";
import { check, engine, file, OWNERS } from "./helpers.ts";

const PATH = "shop/domain/order.py";
const LEAK = "from shop.infrastructure.db import Table\n";
/** The same import inside a docstring: the skeleton reads it, the full parse doesn't. */
const QUOTED = `"""\n${LEAK}"""\n`;

/**
 * The baseline accepting one copy of the domain's leak.
 *
 * @param count - accepted copies.
 * @returns accepted copies by baseline key.
 */
function accepting(count: number): Map<string, number> {
  const [leak] = check(file(PATH, LEAK));
  if (leak === undefined) {
    throw new Error("the leak is not a violation");
  }
  return new Map([[baselineKey(leak), count]]);
}

describe("baselined violations skip the confirming parse", () => {
  test("a skeleton hit the baseline accepts is returned unconfirmed, to be hidden", () => {
    // The full parse would drop the docstring's import, so getting it back
    // shows the confirming parse was skipped.
    expect(engine.checkFiles([file(PATH, QUOTED)], OWNERS)).toEqual([]);
    const skipped = engine.checkFiles([file(PATH, QUOTED)], OWNERS, accepting(1));
    expect(skipped.map((d) => d.code)).toEqual(["INW001"]);
  });

  test("more hits than accepted copies get the full parse, which keeps only the real one", () => {
    const both = file(PATH, `${QUOTED}${LEAK}`);
    const found = engine.checkFiles([both], OWNERS, accepting(1));
    expect(found.map((d) => d.line)).toEqual([4]);
  });

  test("copies are used up across files, as the CLI's baseline does", () => {
    const stub = file("shop/domain/order.pyi", QUOTED);
    const found = engine.checkFiles([file(PATH, LEAK), stub], OWNERS, accepting(1));
    expect(found.map((d) => d.file)).toEqual([PATH]);
  });

  test("a hit the baseline doesn't accept is still confirmed", () => {
    const other = new Map([["INW001\u0000shop.domain.other\u0000x", 1]]);
    expect(engine.checkFiles([file(PATH, QUOTED)], OWNERS, other)).toEqual([]);
  });
});
