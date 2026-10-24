/**
 * @file The `reason` a baseline entry may carry (#412): `inwards baseline`
 * keeps it on the entry whose key still matches, drops it with an entry that
 * went away, and a check refuses one that isn't a string. These drive the
 * baseline module with an in-memory file; `baseline.test.ts` runs the CLI.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ConfigError, type Diagnostic } from "@inwards/core";
import { readBaseline, writeBaseline } from "../../src/check/baseline/_file.ts";

const CONFIG = join("/p", "pyproject.toml");
const FILE = join("/p", "inwards-baseline.json");

/** One entry as the test writes and reads it. */
interface Written {
  code: string;
  module: string;
  message: string;
  count: number;
  reason?: string;
}

/**
 * Makes an INW001 error in a module, with the message an entry stores.
 *
 * @param module - the module the finding is in.
 * @param message - the finding's message.
 * @returns the diagnostic.
 */
function error(module: string, message = "imports infrastructure."): Diagnostic {
  return {
    code: "INW001",
    rule: "dependency-direction",
    severity: "error",
    file: `${module.replaceAll(".", "/")}.py`,
    module,
    message,
    fix: { summary: "", steps: [] },
    docs: "",
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 2,
  };
}

/**
 * An in-memory baseline file that `writeBaseline` reads and replaces.
 *
 * @param initial - the file's text, or undefined for no file.
 * @returns the io bundle, the file's current text, and its entries parsed.
 * @throws {Error} from the io when it is asked for another file, and from
 *   `written` when the file's schema isn't `inwards/baseline@1`.
 */
function memory(initial: string | undefined): {
  io: Parameters<typeof writeBaseline>[0];
  raw: () => string;
  written: () => Written[];
} {
  let text = initial;
  return {
    io: {
      probe: { exists: (path: string): boolean => path === FILE && text !== undefined },
      read: {
        text: (path: string): string => {
          if (path !== FILE || text === undefined) {
            throw new Error(`no file at ${path}`);
          }
          return text;
        },
      },
      baselines: {
        replace: (path: string, next: string): void => {
          if (path !== FILE) {
            throw new Error(`wrote ${path}, not the baseline`);
          }
          text = next;
        },
      },
    },
    raw: (): string => text ?? "",
    written: (): Written[] => {
      const parsed: { schema: string; violations: Written[] } = JSON.parse(text ?? "{}");
      if (parsed.schema !== "inwards/baseline@1") {
        throw new Error(`wrote schema ${parsed.schema}`);
      }
      return parsed.violations;
    },
  };
}

/**
 * Serialises a baseline file.
 *
 * @param violations - its entries.
 * @returns the file's text.
 */
function file(violations: readonly object[]): string {
  return JSON.stringify({ schema: "inwards/baseline@1", violations });
}

const ORDER = {
  code: "INW001",
  module: "shop.domain.order",
  message: "imports infrastructure.",
  count: 1,
};

describe("inwards baseline keeps reasons", () => {
  test("a reason stays on the entry whose key still matches", () => {
    const { io, written } = memory(file([{ ...ORDER, reason: "Moves out in #123" }]));
    writeBaseline(io, CONFIG, [error("shop.domain.order")], undefined);
    expect(written()).toEqual([{ ...ORDER, reason: "Moves out in #123" }]);
  });

  test("a changed count keeps the reason", () => {
    const { io, written } = memory(file([{ ...ORDER, count: 2, reason: "Legacy, #7" }]));
    expect(writeBaseline(io, CONFIG, [error("shop.domain.order")], undefined)).toBe(1);
    expect(written()).toEqual([{ ...ORDER, count: 1, reason: "Legacy, #7" }]);
    writeBaseline(io, CONFIG, [error("shop.domain.order"), error("shop.domain.order")], undefined);
    expect(written()).toEqual([{ ...ORDER, count: 2, reason: "Legacy, #7" }]);
  });

  test("a fixed entry goes with its reason, and a new entry has none", () => {
    const { io, written } = memory(file([{ ...ORDER, reason: "Fixed in #9" }]));
    writeBaseline(io, CONFIG, [error("shop.domain.pay")], undefined);
    expect(written()).toEqual([{ ...ORDER, module: "shop.domain.pay" }]);
    writeBaseline(io, CONFIG, [error("shop.domain.order")], undefined);
    expect(written()).toEqual([ORDER]);
  });

  test("a dormant entry keeps its reason", () => {
    const { io, written } = memory(file([{ ...ORDER, reason: "Rule off for now" }]));
    writeBaseline(io, CONFIG, [], { ignore: ["INW001"] });
    expect(written()).toEqual([{ ...ORDER, reason: "Rule off for now" }]);
  });

  test("the reason comes last and other hand-written keys are dropped", () => {
    const { io, raw } = memory(file([{ reason: "Why", note: "x", ...ORDER }]));
    writeBaseline(io, CONFIG, [error("shop.domain.order")], undefined);
    expect(Object.keys(JSON.parse(raw()).violations[0])).toEqual([
      "code",
      "module",
      "message",
      "count",
      "reason",
    ]);
  });

  test("an entry without a reason is written without the key", () => {
    const { io, raw } = memory(undefined);
    writeBaseline(io, CONFIG, [error("shop.domain.order")], undefined);
    expect(raw()).toContain('"count": 1');
    expect(raw()).not.toContain("reason");
  });
});

describe("reading a baseline with reasons", () => {
  test("a string reason reads like any entry", () => {
    const { io } = memory(file([{ ...ORDER, reason: "Moves out in #123" }]));
    expect(readBaseline(io, CONFIG, undefined)?.size).toBe(1);
  });

  test("a reason that isn't a string is a config error naming the entry", () => {
    for (const reason of [42, true, ["a"], { why: "x" }]) {
      const { io } = memory(file([ORDER, { ...ORDER, module: "shop.domain.pay", reason }]));
      expect(() => readBaseline(io, CONFIG, undefined)).toThrow(ConfigError);
      expect(() => readBaseline(io, CONFIG, undefined)).toThrow(
        'violation 2 (INW001 in shop.domain.pay) has a "reason" that is not a string',
      );
    }
  });

  test("a leading byte order mark is skipped, and inwards baseline keeps the reason", () => {
    const { io, written } = memory(
      `${"\uFEFF"}${file([{ ...ORDER, reason: "Saved by PowerShell" }])}`,
    );
    expect(readBaseline(io, CONFIG, undefined)?.size).toBe(1);
    writeBaseline(io, CONFIG, [error(ORDER.module)], undefined);
    expect(written()).toEqual([{ ...ORDER, reason: "Saved by PowerShell" }]);
  });

  test("a null reason counts as none, and inwards baseline drops it", () => {
    const { io, raw } = memory(file([{ ...ORDER, reason: null }]));
    expect(readBaseline(io, CONFIG, undefined)?.size).toBe(1);
    writeBaseline(io, CONFIG, [error(ORDER.module)], undefined);
    expect(JSON.parse(raw()).violations).toEqual([ORDER]);
  });

  test("other unknown keys are still tolerated", () => {
    const { io } = memory(
      JSON.stringify({ schema: "inwards/baseline@1", justification: {}, violations: [ORDER] }),
    );
    expect(readBaseline(io, CONFIG, undefined)?.size).toBe(1);
  });
});
