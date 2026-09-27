/**
 * @file The baseline shortcut: a file whose skeleton findings the baseline accepts
 * in full skips the confirming parse. The tests check that the answer stays
 * the same either way.
 */
import { describe, expect, test } from "bun:test";
import { baselineKey, type Diagnostic } from "../../src/index.ts";
import { check, engine, file, PROJECT } from "../support/helpers.ts";

const PATH = "shop/domain/order.py";
const STUB = "shop/domain/order.pyi";
const LEAK = "from shop.infrastructure.db import Table\n";
/** The same import inside a docstring: the skeleton reads it, the full parse doesn't. */
const QUOTED = `"""\n${LEAK}"""\n`;
/** The same import inside a string assigned to a name. */
const STRING = `x = '''\n${LEAK}'''\n`;
const SPELLINGS: string[] = ["", LEAK, QUOTED, STRING, `${QUOTED}${LEAK}`, `${LEAK}${LEAK}`];

/**
 * The baseline accepting copies of the domain's leak.
 *
 * @param count - accepted copies.
 * @returns accepted copies by baseline key.
 * @throws {Error} when the leak isn't a violation, so the test setup is wrong.
 */
function accepting(count: number): Map<string, number> {
  const [leak] = check(file(PATH, LEAK));
  if (leak === undefined) {
    throw new Error("the leak is not a violation");
  }
  return new Map([[baselineKey(leak), count]]);
}

/**
 * What a check shows once the baseline hides what it accepts, as the CLI's
 * baseline does: errors only, each key up to its count, in report order.
 *
 * @param found - the engine's findings.
 * @param accepted - accepted copies by key.
 * @returns the errors left, as `file:line:key`.
 */
function shown(found: readonly Diagnostic[], accepted: ReadonlyMap<string, number>): string[] {
  const left = new Map(accepted);
  return found
    .filter((d) => {
      const n = d.severity === "error" ? (left.get(baselineKey(d)) ?? 0) : 0;
      left.set(baselineKey(d), n - 1);
      return n <= 0;
    })
    .map((d) => `${d.file}:${d.line}:${baselineKey(d)}`);
}

describe("baselined violations skip the confirming parse", () => {
  test("a skeleton hit the baseline accepts is returned unconfirmed, to be hidden", () => {
    // The full parse would drop the docstring's import, so getting it back
    // shows the confirming parse was skipped.
    expect(engine.checkFiles([file(PATH, QUOTED)], PROJECT)).toEqual([]);
    const skipped = engine.checkFiles([file(PATH, QUOTED)], PROJECT, accepting(1));
    expect(skipped.map((d) => d.code)).toEqual(["INW001"]);
  });

  test("more hits than accepted copies get the full parse, which keeps only the real one", () => {
    const both = file(PATH, `${QUOTED}${LEAK}`);
    const found = engine.checkFiles([both], PROJECT, accepting(1));
    expect(found.map((d) => d.line)).toEqual([4]);
  });

  test("hits are totalled across a module's files before anything is skipped", () => {
    const found = engine.checkFiles([file(PATH, QUOTED), file(STUB, LEAK)], PROJECT, accepting(1));
    expect(found.map((d) => d.file)).toEqual([STUB]);
  });

  test("a hit the baseline doesn't accept is still confirmed", () => {
    const other = new Map([["INW001\u0000shop.domain.other\u0000x", 1]]);
    expect(engine.checkFiles([file(PATH, QUOTED)], PROJECT, other)).toEqual([]);
  });

  // Every pair of spellings in order.py and order.pyi, with 0 to 2 accepted
  // copies: what is shown must be what the full parse of every file shows.
  test.each(
    SPELLINGS.flatMap((py) =>
      SPELLINGS.flatMap((pyi) => [0, 1, 2].map((n): [string, string, number] => [py, pyi, n])),
    ),
  )("order.py %j, order.pyi %j, %i accepted: shows what the full parse shows", (py, pyi, n) => {
    const files = [file(PATH, py), file(STUB, pyi)];
    const accepted = accepting(n);
    const plain = shown(engine.checkFiles(files, PROJECT), accepted);
    expect(shown(engine.checkFiles(files, PROJECT, accepted), accepted)).toEqual(plain);
  });
});
