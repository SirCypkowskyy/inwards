/**
 * @file The JSON Schema for `[tool.inwards]` (`schema/tool-inwards.schema.json`,
 * #51) and the parser agree. Their keys, rule codes and defaults are compared,
 * every required key, type, enum, bound and INW000 restriction is exercised on
 * both sides, and every config the repository ships or documents validates.
 * Relations between entries fail the parser only, since draft-07 can't express
 * them. The whole-file schema built from the table schema is checked too:
 * fresh, accepting whole `pyproject.toml` files, and leaving other tables alone.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { CONTEXT_KEYS } from "../../src/config/contexts.ts";
import { CONFIG_DEFAULTS } from "../../src/config/defaults.ts";
import { DEFAULT_GENERATED } from "../../src/config/generated.ts";
import { LAYER_KEYS, parseConfig, TABLE_KEYS } from "../../src/config/parse.ts";
import { RULE_KEYS } from "../../src/config/rule-settings.ts";
import { NAME_KEYS, SHAPE_KEYS } from "../../src/config/shape.ts";
import { RULES } from "../../src/meta/registry.ts";
import {
  fileSchemaErrors,
  MINIMAL,
  parserError,
  REPO,
  read,
  type Schema,
  schema,
  schemaErrors,
} from "../support/config-schema.ts";
import { snippetProblems } from "../support/snippets.ts";

/** A link from a schema description to an anchor of the configuration reference. */
const REFERENCE_ANCHOR = /guides\/configuration\/#(?<anchor>[a-z-]+)\)/gu;
/** Mentions the table, so a shipped file configures Inwards. */
const INWARDS_TABLE = /\[\s*tool\.inwards/u;

/**
 * Follows a `$ref` (also one wrapped in `allOf`) to its definition.
 *
 * @param node - a schema node.
 * @returns the definition it points to, or the node itself.
 */
function deref(node: Schema): Schema {
  const ref = node.$ref ?? node.allOf?.find((part) => part.$ref !== undefined)?.$ref;
  const name = ref?.split("/").at(-1);
  return name === undefined ? node : (schema.definitions?.[name] ?? node);
}

/**
 * Lists the property names a schema node allows.
 *
 * @param node - an object schema, or a reference to one.
 * @returns the names, sorted.
 */
function keysOf(node: Schema): string[] {
  return Object.keys(deref(node).properties ?? {}).sort();
}

/**
 * Finds the item schema of an array-valued top-level key.
 *
 * @param key - a key of `[tool.inwards]`, such as `layers`.
 * @returns the schema of one entry, empty when the key isn't an array.
 */
function itemsOf(key: string): Schema {
  return schema.properties?.[key]?.items ?? {};
}

/**
 * Lists the Markdown pages below a docs directory.
 *
 * @param dir - a repo-relative directory.
 * @returns repo-relative paths.
 */
function pages(dir: string): string[] {
  return readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      return pages(rel);
    }
    return entry.name.endsWith(".md") ? [rel] : [];
  });
}

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

describe("the schema and the parser agree", () => {
  test("on the keys at every level", () => {
    expect(keysOf(schema)).toEqual([...TABLE_KEYS].sort());
    expect(keysOf(itemsOf("layers"))).toEqual([...LAYER_KEYS].sort());
    expect(keysOf(itemsOf("shape"))).toEqual([...SHAPE_KEYS].sort());
    expect(keysOf(itemsOf("names"))).toEqual([...NAME_KEYS].sort());
    expect(keysOf(itemsOf("contexts"))).toEqual([...CONTEXT_KEYS].sort());
    expect(keysOf(schema.properties?.["rules"] ?? {})).toEqual([...RULE_KEYS].sort());
  });

  test("on the rule codes, taken from the registry", () => {
    expect(schema.definitions?.["ruleCode"]?.enum?.sort()).toEqual(Object.keys(RULES).sort());
  });

  test("on the defaults, as annotated and as the parser fills them in", () => {
    const props = schema.properties ?? {};
    const context = deref(itemsOf("contexts")).properties ?? {};
    const shape = deref(itemsOf("shape")).properties ?? {};
    expect({
      root: props["root"]?.default,
      escalateAfter: props["escalate-after"]?.default,
      runLog: props["run-log"]?.default,
      stopGate: props["stop-gate"]?.default,
      agentSuppressions: props["agent-suppressions"]?.default,
      shapeExtra: shape["extra"]?.default,
    }).toEqual({ ...CONFIG_DEFAULTS });
    expect(props["generated"]?.default).toEqual([...DEFAULT_GENERATED]);
    expect(context["public"]?.default).toEqual([]);
    expect(context["depends-on"]?.default).toEqual([]);
    const parsed = parseConfig(
      withExtra('[[tool.inwards.shape]]\npackages = ["shop.*"]\nallow = ["x"]\n'),
    );
    expect([parsed.root, parsed.shape?.[0]?.extra]).toEqual([
      CONFIG_DEFAULTS.root,
      CONFIG_DEFAULTS.shapeExtra,
    ]);
  });

  test("its reference links land on anchors the configuration page has", () => {
    const page = read("docs/chapters/guides/configuration.md");
    const anchors = [...JSON.stringify(schema).matchAll(REFERENCE_ANCHOR)].map(
      (m) => m.groups?.["anchor"] ?? "",
    );
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.filter((anchor) => !page.includes(`{ #${anchor} }`))).toEqual([]);
  });
});

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
    // Pattern syntax.
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

  test("valid member globs pass both", () => {
    const text = withExtra(
      '[[tool.inwards.shape]]\npackages = ["shop.*"]\nallow = ["test_*", "[!_]*", "[]x]y", "?.py", "pkg/"]\n',
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

describe("every shipped and documented config validates", () => {
  // examples/clean-app has no pyproject.toml: the repository's own config checks it.
  const configs = [
    ...readdirSync(join(REPO, "examples")).map((dir) => `examples/${dir}/pyproject.toml`),
    "eval/pyproject.toml",
    "pyproject.toml",
  ].filter((path) => INWARDS_TABLE.test(read(path)));

  test("the list isn't empty", () => {
    expect(configs.length).toBeGreaterThan(1);
  });

  test.each(configs)("%s, with both the table and the whole-file schema", (path) => {
    expect(parserError(read(path))).toBeUndefined();
    expect(schemaErrors(read(path))).toEqual([]);
    expect(fileSchemaErrors(read(path))).toEqual([]);
  });

  test.each([...pages("docs/chapters"), ...pages("docs/pl")])("docs: %s", (path) => {
    expect(snippetProblems(path, read(path))).toEqual([]);
  });
});

describe("the whole-file schema", () => {
  test("is what scripts/build-pyproject-schema.ts builds from the table schema", () => {
    const run = Bun.spawnSync(
      [process.execPath, "run", "scripts/build-pyproject-schema.ts", "--check"],
      { cwd: REPO },
    );
    expect([run.exitCode, run.stderr.toString()]).toEqual([0, ""]);
  });

  test("leaves other tables alone and checks [tool.inwards]", () => {
    const other = `[project]\nname = "shop"\ndependencies = [1, 2]\n\n[tool.ruff]\nanything = { goes = true }\n\n${MINIMAL}`;
    expect(fileSchemaErrors(other)).toEqual([]);
    expect(fileSchemaErrors(`${other}colour = true\n`)).not.toEqual([]);
    expect(fileSchemaErrors('[project]\nname = "no inwards at all"\n')).toEqual([]);
  });
});
