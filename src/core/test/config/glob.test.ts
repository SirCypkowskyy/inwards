import { describe, expect, test } from "bun:test";
import { globMatches, isGlob } from "../../src/config/glob.ts";
import { memberMatches } from "../../src/config/shape.ts";

describe("globMatches: parity with Python's fnmatch.fnmatchcase", () => {
  // Each row was checked with CPython 3.14's fnmatch.fnmatchcase(text, glob).
  test.each([
    ["gen[?-z]", "gen0", false],
    ["gen[?-z]", "gena", true],
    ["gen[?-z]", "gen?", true],
    ["gen[*]", "gen*", true],
    ["gen[*]", "genx", false],
    ["[!_]*_pb2", "orders_pb2", true],
    ["[!_]*_pb2", "_orders_pb2", false],
    ["[]]x", "]x", true],
    ["[a-]", "-", true],
    ["[a-]", "b", false],
    ["[-a]", "-", true],
    ["[!a-c]x", "dx", true],
    ["[!a-c]x", "bx", false],
    ["x[\\]", "x\\", true],
    ["x[$^]", "x^", true],
    ["x[$^]", "x$", true],
    ["x[.]", "x.", true],
    ["x[.]", "xa", false],
    ["x+y", "x+y", true],
    ["x+y", "xxy", false],
    ["a(b)", "a(b)", true],
    ["?", "é", true],
    ["ż*", "żółw", true],
    ["test_*", "test_x", true],
    ["test_*", "test_", true],
    ["*_*_x", "a_b_x", true],
    ["*_*_x", "a_x", false],
    ["*", "", true],
    ["?", "", false],
  ])("%j against %j is %p", (glob, text, want) => {
    expect(globMatches(glob, text)).toBe(want);
  });

  test.each([
    ["[abc", "an unclosed ["],
    ["x[]", "a [ closed by nothing"],
    ["[!]", "an unclosed [!"],
    ["[z-a]x", "a reversed range"],
  ])("%j is malformed (%s) and matches nothing", (glob) => {
    expect(isGlob(glob)).toBe(false);
    expect(globMatches(glob, glob)).toBe(false);
  });
});

describe("globMatches: bounded time", () => {
  test("many stars against a long agent-written name stay fast", () => {
    // A regex translation (`.*` per star) took about 160 ms with four stars on
    // 240 characters, a file name an agent can create; six would take minutes.
    const name = `${"_".repeat(250)}x`;
    const start = performance.now();
    expect(globMatches("*_*_*_*_*_*_pb2", name)).toBe(false);
    expect(memberMatches("*_*_*_*_*_*_pb2.py", `${name}.py`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
