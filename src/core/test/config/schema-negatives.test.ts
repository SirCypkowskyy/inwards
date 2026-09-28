/**
 * @file Paired negative cases for the `[tool.inwards]` JSON Schema (#51): each
 * structural mistake (a missing required key, a wrong type, an unknown value,
 * a broken bound, a misspelled key, bad pattern syntax, INW000 turned off) must
 * fail both the schema and the parser, so relaxing either one fails a test.
 * Relations between entries fail the parser only, since draft-07 can't see them.
 */
import { describe, expect, test } from "bun:test";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";

/**
 * Builds a config from the minimal one plus extra TOML.
 *
 * @param extra - keys or tables to add.
 * @returns the config text.
 */
function withExtra(extra: string): string {
  return `${MINIMAL}${extra}`;
}

/**
 * Builds a config whose only layer is the given inline table.
 *
 * @param layer - the layer's TOML inline table.
 * @returns the config text.
 */
function withLayer(layer: string): string {
  return `[tool.inwards]\nlayers = [${layer}]\n`;
}

describe("structural mistakes fail both the schema and the parser", () => {
  test.each([
    // Required keys.
    ["no layers", '[tool.inwards]\nroot = "."\n'],
    ["a layer without a name", withLayer('{ modules = ["shop"] }')],
    ["a layer without modules", withLayer('{ name = "d" }')],
    ["a shape without packages", withExtra('[[tool.inwards.shape]]\nallow = ["x"]\n')],
    ["a names entry without a pattern", withExtra('[[tool.inwards.names]]\nonly-in = ["shop"]\n')],
    ["a names entry without only-in", withExtra('[[tool.inwards.names]]\npattern = "x"\n')],
    ["a context without a name", withExtra('[[tool.inwards.contexts]]\nmodules = ["shop.a"]\n')],
    ["a context without modules", withExtra('[[tool.inwards.contexts]]\nname = "a"\n')],
    // Unknown keys.
    ["an unknown key", withExtra("colour = true\n")],
    ["an unknown layer key", withLayer('{ name = "d", modules = ["shop"], colour = 1 }')],
    ["an unknown rules key", withExtra('[tool.inwards.rules]\nenable = ["INW001"]\n')],
    // Types.
    ["a non-string root", withExtra("root = 1\n")],
    ["a non-boolean run-log", withExtra('run-log = "yes"\n')],
    ["a fractional escalate-after", withExtra("escalate-after = 1.5\n")],
    ["an ignore that isn't a list", withExtra('ignore = "tests"\n')],
    ["layers that aren't an array", '[tool.inwards]\nlayers = "domain"\n'],
    ["a generated that isn't a list", withExtra('generated = "*_pb2"\n')],
    ["rules that aren't a table", withExtra('rules = ["INW001"]\n')],
    ["a select that isn't a list", withExtra('[tool.inwards.rules]\nselect = "INW001"\n')],
    ["a context that isn't a table", withExtra("contexts = [3]\n")],
    // Enums and formats.
    ["an unknown stop-gate", withExtra('stop-gate = "always"\n')],
    ["cycles that isn't a list", withExtra('cycles = "modules"\n')],
    ["an unknown cycle mode", withExtra('cycles = ["loops"]\n')],
    ["a repeated cycle mode", withExtra('cycles = ["modules", "modules"]\n')],
    ["an unknown agent-suppressions", withExtra('agent-suppressions = "maybe"\n')],
    [
      "an unknown shape extra",
      withExtra('[[tool.inwards.shape]]\npackages = ["shop.*"]\nextra = "fatal"\n'),
    ],
    ["an unknown rule code", withExtra('[tool.inwards.rules]\nselect = ["INW999"]\n')],
    ["an unknown severity", withExtra('[tool.inwards.rules]\nseverity = { INW001 = "fatal" }\n')],
    ["a short required-version", withExtra('required-version = "1.2"\n')],
    // Bounds.
    ["empty layers", "[tool.inwards]\nlayers = []\n"],
    ["escalate-after of zero", withExtra("escalate-after = 0\n")],
    ["an empty select", withExtra("[tool.inwards.rules]\nselect = []\n")],
    ["a shape with no packages", withExtra("[[tool.inwards.shape]]\npackages = []\n")],
    ["names with no only-in", withExtra('[[tool.inwards.names]]\npattern = "x"\nonly-in = []\n')],
    [
      "a context with no modules",
      withExtra('[[tool.inwards.contexts]]\nname = "a"\nmodules = []\n'),
    ],
    [
      "a blank context name",
      withExtra('[[tool.inwards.contexts]]\nname = " "\nmodules = ["shop.a"]\n'),
    ],
    // INW000 can't be turned off or re-levelled.
    ["INW000 in ignore", withExtra('[tool.inwards.rules]\nignore = ["INW000"]\n')],
    ["INW000 in severity", withExtra('[tool.inwards.rules]\nseverity = { INW000 = "warning" }\n')],
    // Empty strings and repeats.
    ["an empty layer name", withLayer('{ name = "", modules = ["shop"] }')],
    ["an empty layer module", withLayer('{ name = "d", modules = [""] }')],
    ["an empty ignore entry", withExtra('ignore = [""]\n')],
    ["an empty generated pattern", withExtra('generated = [""]\n')],
    ["an empty library", withLayer('{ name = "d", modules = ["shop"], allow-libraries = [""] }')],
    [
      "an empty member pattern",
      withExtra('[[tool.inwards.shape]]\npackages = ["shop"]\nallow = [""]\n'),
    ],
    [
      "an empty public entry",
      withExtra('[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.a"]\npublic = [""]\n'),
    ],
    [
      "a repeated depends-on",
      withExtra(
        '[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.a"]\ndepends-on = ["b", "b"]\n[[tool.inwards.contexts]]\nname = "b"\nmodules = ["shop.b"]\n',
      ),
    ],
    // Misspelled keys inside entries.
    [
      "a misspelled shape key",
      withExtra('[[tool.inwards.shape]]\npackages = ["shop"]\nalow = ["x"]\n'),
    ],
    [
      "a misspelled names key",
      withExtra('[[tool.inwards.names]]\npattern = "x"\nonly_in = ["shop"]\n'),
    ],
    [
      "a misspelled context key",
      withExtra('[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.a"]\ndepends_on = []\n'),
    ],
    ["a misspelled rules key", withExtra("[tool.inwards.rules]\nselected = []\n")],
    // Pattern syntax.
    [
      "an empty bracket set",
      withExtra('[[tool.inwards.shape]]\npackages = ["shop"]\nallow = ["[]"]\n'),
    ],
    [
      "an empty negated set",
      withExtra('[[tool.inwards.names]]\npattern = "[!]"\nonly-in = ["shop"]\n'),
    ],
    [
      "an empty set after a name",
      withExtra('[[tool.inwards.shape]]\npackages = ["shop"]\nallow = ["x[]"]\n'),
    ],
    ["a wildcard-only generated pattern", withExtra('generated = ["*"]\n')],
    [
      "a wildcard in a context",
      withExtra('[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.*"]\n'),
    ],
    [
      "a member pattern with a slash inside",
      withExtra('[[tool.inwards.shape]]\npackages = ["shop.*"]\nallow = ["a/b"]\n'),
    ],
    [
      "an unclosed bracket in a member pattern",
      withExtra('[[tool.inwards.shape]]\npackages = ["shop"]\nallow = ["[abc"]\n'),
    ],
    ["an empty selector segment", withExtra('[[tool.inwards.shape]]\npackages = ["shop..x"]\n')],
    [
      "a layer selector with no leading package",
      withLayer('{ name = "d", modules = ["*.domain"] }'),
    ],
    ["a layer selector that is only **", withLayer('{ name = "d", modules = ["**"] }')],
    [
      "a partial wildcard in a layer selector",
      withLayer('{ name = "d", modules = ["shop.dom*"] }'),
    ],
    ["a ? in a layer selector", withLayer('{ name = "d", modules = ["shop.*?"] }')],
    ["a bracket in a layer selector", withLayer('{ name = "d", modules = ["shop.[ab].*"] }')],
    ["an empty layer selector segment", withLayer('{ name = "d", modules = ["shop..*"] }')],
    ["a path in a layer selector", withLayer('{ name = "d", modules = ["shop/*/domain"] }')],
    ["*** in a layer selector", withLayer('{ name = "d", modules = ["shop.***"] }')],
    [
      "a digit-led segment in a layer selector",
      withLayer('{ name = "d", modules = ["shop.*.1abc"] }'),
    ],
    ["punctuation in a layer selector", withLayer('{ name = "d", modules = ["shop.*.a+b"] }')],
    [
      "a digit-led first segment in a layer selector",
      withLayer('{ name = "d", modules = ["1shop.*"] }'),
    ],
    [
      "a distribution name as a library",
      withLayer('{ name = "d", modules = ["shop"], deny-libraries = ["python-dateutil"] }'),
    ],
  ])("%s", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("INW000 may still be selected", () => {
    const text = withExtra('[tool.inwards.rules]\nselect = ["INW000", "INW001"]\n');
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });

  test("layer selectors and lenient literal entries pass both", () => {
    const text = withLayer(
      '{ name = "d", modules = ["shop.*.domain", "shop.**", "shop.**.domain.**", "shop.domain"] }, { name = "e", modules = [] }',
    );
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });

  test("valid member globs pass both", () => {
    const text = withExtra(
      '[[tool.inwards.shape]]\npackages = ["shop.*"]\nallow = ["test_*", "[!_]*", "[]x]y", "[]]", "[!]]", "?.py", "pkg/"]\n',
    );
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});

describe("relations between entries fail the parser only: draft-07 can't see them", () => {
  test.each([
    [
      "a repeated context name",
      withExtra(
        '[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.a"]\n[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.b"]\n',
      ),
    ],
    [
      "depends-on naming no context",
      withExtra(
        '[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.a"]\ndepends-on = ["b"]\n',
      ),
    ],
    [
      "a public entry outside its context",
      withExtra(
        '[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.a"]\npublic = ["shop.b"]\n',
      ),
    ],
    [
      "a repeated layer name",
      withLayer('{ name = "d", modules = ["a"] }, { name = "d", modules = ["b"] }'),
    ],
    [
      "a reversed range in a member glob",
      withExtra('[[tool.inwards.shape]]\npackages = ["shop"]\nallow = ["[z-a]"]\n'),
    ],
    ["a required-version newer than this Inwards", withExtra('required-version = "999.0.0"\n')],
  ])("%s", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).toEqual([]);
  });

  test("legacy layer entries the parser accepts stay valid in the schema", () => {
    const legacy =
      '[tool.inwards]\nlayers = [{ name = "domain", modules = ["shop-domain", "shop..x"] }, { name = "empty", modules = [] }]\n';
    expect([parserError(legacy), schemaErrors(legacy)]).toEqual([undefined, []]);
  });
});
