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
