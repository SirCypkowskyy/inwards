/**
 * @file The JSON Schema for `[tool.inwards]` (`schema/tool-inwards.schema.json`,
 * #51) and the parser agree. Their keys, enums and defaults are compared at
 * every level, every config the repository ships or documents validates, and
 * negative samples fail where they should: structural ones fail both, and
 * relations between entries fail the parser only, since draft-07 can't express
 * them. Docs snippets are classified with `<!-- config: fragment -->` or
 * `<!-- config: invalid -->`; an unmarked one must be a complete, valid config.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import { parse, stringify } from "smol-toml";
import { CONTEXT_KEYS } from "../../src/config/contexts.ts";
import { CONFIG_DEFAULTS } from "../../src/config/defaults.ts";
import { DEFAULT_GENERATED } from "../../src/config/generated.ts";
import { LAYER_KEYS, parseConfig, TABLE_KEYS } from "../../src/config/parse.ts";
import { RULE_KEYS } from "../../src/config/rule-settings.ts";
import { NAME_KEYS, SHAPE_KEYS } from "../../src/config/shape.ts";
import { ConfigError, isRecord } from "../../src/config/toml.ts";
import { RULES } from "../../src/meta/registry.ts";

const REPO = resolve(import.meta.dir, "../../../..");
/** A docs fence that holds TOML, with the marker line before it if any. */
const TOML_FENCE =
  /(?:^(?<marker><!--\s*config:\s*(?<kind>\w+)\s*-->)\n\n)?^ *```toml[^\n]*\n(?<body>[\s\S]*?)\n *```$/gmu;
/** Any spelling of a config marker, so a near miss is caught. */
const MARKER = /<!--\s*config:[^>]*-->/gu;
/** Mentions the table, so the snippet is about Inwards' config. */
const INWARDS_TABLE = /\[\s*tool\.inwards/u;
/** A link from a schema description to an anchor of the configuration reference. */
const REFERENCE_ANCHOR = /guides\/configuration\/#(?<anchor>[a-z-]+)\)/gu;
/** The smallest valid config a fragment is merged into. */
const MINIMAL = '[tool.inwards]\nlayers = [{ name = "domain", modules = ["shop.domain"] }]\n';

/** The part of the schema these tests walk. */
interface Schema {
  properties?: Record<string, Schema>;
  definitions?: Record<string, Schema>;
  items?: Schema;
  allOf?: Schema[];
  // biome-ignore lint/style/useNamingConvention: the JSON Schema keyword is spelled $ref.
  $ref?: string;
  enum?: string[];
  default?: unknown;
}

const schema: Schema = JSON.parse(
  readFileSync(join(REPO, "schema/tool-inwards.schema.json"), "utf8"),
);
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addKeyword("markdownDescription");
const validate: ValidateFunction = ajv.compile(schema);

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
 * Validates the `[tool.inwards]` table of a pyproject text with the schema.
 *
 * @param text - the whole TOML text.
 * @returns the schema's errors, empty when it validates.
 */
function schemaErrors(text: string): string[] {
  const doc = parse(text);
  const tool = isRecord(doc["tool"]) ? doc["tool"] : {};
  const valid = validate(tool["inwards"]);
  return valid ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

/**
 * Tells whether the parser accepts a pyproject text.
 *
 * @param text - the whole TOML text.
 * @returns the config error's message, or undefined when it parses.
 * @throws {Error} anything other than a ConfigError, which would be a bug.
 */
function parserError(text: string): string | undefined {
  try {
    parseConfig(text);
    return undefined;
  } catch (err) {
    if (err instanceof ConfigError) {
      return err.message;
    }
    throw err;
  }
}

/**
 * Merges a fragment's `[tool.inwards]` keys into the minimal config.
 *
 * @param fragment - TOML that sets some keys of `[tool.inwards]`.
 * @returns the complete config's text.
 */
function merged(fragment: string): string {
  const base = parse(MINIMAL);
  const extra = parse(fragment);
  const baseTool = isRecord(base["tool"]) ? base["tool"] : {};
  const extraTool = isRecord(extra["tool"]) ? extra["tool"] : {};
  const inwards = {
    ...(isRecord(baseTool["inwards"]) ? baseTool["inwards"] : {}),
    ...(isRecord(extraTool["inwards"]) ? extraTool["inwards"] : {}),
  };
  return stringify({ ...extra, tool: { ...extraTool, inwards } });
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
 * Reads a repository file, or nothing when it doesn't exist.
 *
 * @param path - a repo-relative path.
 * @returns the text, empty when the file is missing.
 */
function read(path: string): string {
  const full = join(REPO, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

/**
 * Checks every Inwards TOML fence of a docs page, and that each config
 * marker sits right before a TOML fence.
 *
 * @param path - the page's repo-relative path, for messages.
 * @param text - the page's Markdown.
 * @returns one line per problem, empty when the page is fine.
 */
function snippetProblems(path: string, text: string): string[] {
  const problems: string[] = [];
  let used = 0;
  for (const match of text.matchAll(TOML_FENCE)) {
    const { body = "", kind } = match.groups ?? {};
    used += kind === undefined ? 0 : 1;
    if (INWARDS_TABLE.test(body)) {
      problems.push(...fenceProblems(`${path}: ${body.split("\n")[0]}`, body, kind));
    }
  }
  const markers = (text.match(MARKER) ?? []).length;
  if (markers !== used) {
    problems.push(`${path}: ${markers - used} config marker(s) not right before a TOML fence`);
  }
  return problems;
}

/**
 * Checks one Inwards TOML fence as its marker classifies it: a complete
 * config (no marker) or a fragment must parse and validate, and an invalid
 * example must fail the parser.
 *
 * @param where - the page and the fence's first line, for messages.
 * @param body - the fence's TOML.
 * @param kind - the marker's kind (`fragment`, `invalid`), or undefined.
 * @returns one line per problem, empty when the fence is fine.
 */
function fenceProblems(where: string, body: string, kind: string | undefined): string[] {
  if (kind === "invalid") {
    return parserError(body) === undefined ? [`${where}: marked invalid, but it parses`] : [];
  }
  if (kind !== undefined && kind !== "fragment") {
    return [`${where}: unknown config marker "${kind}"`];
  }
  const config = kind === "fragment" ? merged(body) : body;
  const error = parserError(config);
  if (error !== undefined) {
    return [`${where}: ${kind === "fragment" ? "fragment" : "complete config"}: ${error}`];
  }
  return schemaErrors(config).map((problem) => `${where}: schema: ${problem}`);
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

  test("its reference links land on anchors the configuration page has", () => {
    const page = read("docs/chapters/guides/configuration.md");
    const anchors = [...JSON.stringify(schema).matchAll(REFERENCE_ANCHOR)].map(
      (m) => m.groups?.["anchor"] ?? "",
    );
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.filter((anchor) => !page.includes(`{ #${anchor} }`))).toEqual([]);
  });

  test("on the defaults", () => {
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
  });
});

describe("every shipped config validates", () => {
  // examples/clean-app has no pyproject.toml: the repository's own config checks it.
  const configs = [
    ...readdirSync(join(REPO, "examples")).map((dir) => `examples/${dir}/pyproject.toml`),
    "eval/pyproject.toml",
    "pyproject.toml",
  ].filter((path) => INWARDS_TABLE.test(read(path)));

  test("the list isn't empty", () => {
    expect(configs.length).toBeGreaterThan(1);
  });

  test.each(configs)("%s", (path) => {
    expect(parserError(read(path))).toBeUndefined();
    expect(schemaErrors(read(path))).toEqual([]);
  });
});

describe("docs snippets are classified and valid", () => {
  const files = [...pages("docs/chapters"), ...pages("docs/pl")];

  test.each(files)("%s", (path) => {
    expect(snippetProblems(path, read(path))).toEqual([]);
  });
});

/**
 * Builds a config from the minimal one plus extra TOML.
 *
 * @param extra - keys or tables to add.
 * @returns the config text.
 */
function withExtra(extra: string): string {
  return `${MINIMAL}${extra}`;
}

describe("negative samples", () => {
  test.each([
    ["an unknown key", withExtra("colour = true\n")],
    ["no layers", '[tool.inwards]\nroot = "."\n'],
    ["escalate-after of zero", withExtra("escalate-after = 0\n")],
    ["an unknown stop-gate", withExtra('stop-gate = "always"\n')],
    ["an unknown rule code", withExtra('[tool.inwards.rules]\nselect = ["INW999"]\n')],
    ["INW000 in ignore", withExtra('[tool.inwards.rules]\nignore = ["INW000"]\n')],
    ["a wildcard-only generated pattern", withExtra('generated = ["*"]\n')],
    ["a context without modules", withExtra('[[tool.inwards.contexts]]\nname = "a"\n')],
    [
      "a wildcard in a context",
      withExtra('[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.*"]\n'),
    ],
    [
      "a member pattern with a slash inside",
      withExtra('[[tool.inwards.shape]]\npackages = ["shop.*"]\nallow = ["a/b"]\n'),
    ],
  ])("%s fails both the schema and the parser", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

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
    ["a required-version newer than this Inwards", withExtra('required-version = "999.0.0"\n')],
  ])("%s fails the parser only: the schema can't see relations", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).toEqual([]);
  });

  test("legacy layer entries the parser accepts stay valid in the schema", () => {
    const legacy =
      '[tool.inwards]\nlayers = [{ name = "domain", modules = ["shop-domain", "shop..x"] }, { name = "empty", modules = [] }]\n';
    expect(parserError(legacy)).toBeUndefined();
    expect(schemaErrors(legacy)).toEqual([]);
  });
});
