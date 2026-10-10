/**
 * @file `inwards import-config` (#55) on the examples from import-linter's own
 * docs, kept in `fixtures/import-linter/docs` in both INI and TOML. Each must
 * convert to a table that parses and validates against the JSON Schema, both
 * spellings must give the same table, and each contract gets the verdict
 * listed here (mapped, partial or skipped with a reason).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseConfig } from "@inwards/core";
import Ajv from "ajv";
import { convert } from "../../src/init/import-linter/convert.ts";
import type { Outcome } from "../../src/init/import-linter/model.ts";
import { readIni, readToml } from "../../src/init/import-linter/read.ts";
import { renderToml } from "../../src/init/import-linter/render.ts";

const REPO = resolve(import.meta.dir, "../../../..");
const FIXTURES = join(import.meta.dir, "../support/fixtures/import-linter");
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addKeyword("markdownDescription");
const validate = ajv.compile(
  JSON.parse(readFileSync(join(REPO, "schema/tool-inwards.schema.json"), "utf8")),
);

const EXTENSION = /\.(?<ext>importlinter|toml)$/u;

/**
 * Picks `tool.inwards` out of rendered TOML.
 *
 * @param toml - the rendered table.
 * @returns the parsed table.
 */
function table(toml: string): unknown {
  const doc: unknown = Bun.TOML.parse(toml);
  const tool = typeof doc === "object" && doc !== null ? Reflect.get(doc, "tool") : undefined;
  return typeof tool === "object" && tool !== null ? Reflect.get(tool, "inwards") : undefined;
}

// What each example from import-linter's docs converts to. They are in
// fixtures/import-linter/docs, in INI and TOML, taken as the docs print them
// except for a root_package where a snippet had none, `as_packages = false`
// where the TOML said `False`, and a second id where two INI sections repeated one.
const DOC_EXAMPLES: Record<string, Outcome["status"][]> = {
  "acyclic_siblings-1": ["skipped", "skipped"],
  "forbidden-1": ["partial", "skipped", "skipped"],
  "forbidden-2": ["partial"],
  "independence-1": ["partial"],
  "index-1": ["partial"],
  "layers-1": ["mapped"],
  "layers-2": ["mapped"],
  "layers-3": ["mapped"],
  "layers-4": ["partial"],
  "layers-5": ["partial"],
  "layers-6": ["mapped"],
  "layers-7": ["mapped"],
  "layers-8": ["skipped"],
  "protected-1": ["skipped"],
  "protected-2": ["skipped"],
  "protected-3": ["skipped"],
};

describe("import-linter's own examples", () => {
  const files = readdirSync(join(FIXTURES, "docs"));
  test("every example has an expectation", () => {
    const names = [...new Set(files.map((f) => f.replace(EXTENSION, "")))].sort();
    expect(names).toEqual(Object.keys(DOC_EXAMPLES).sort());
  });

  test("forbidden-2: mypackage.one and two -> django and requests convert without a skip (#219)", () => {
    const text = readFileSync(join(FIXTURES, "docs", "forbidden-2.importlinter"), "utf8");
    const config = readIni(text);
    const result = typeof config === "object" ? convert(config) : config;
    if (typeof result !== "object") {
      throw new Error(String(result));
    }
    // Only ignore_imports is left: the libraries go to a prefix deny.
    expect(result.outcomes[0]?.reasons.map((r) => r.split(" ")[0])).toEqual(["ignore_imports"]);
    expect(result.draft.deny).toEqual([
      { modules: ["mypackage.one", "mypackage.two"], libraries: ["django", "requests"] },
    ]);
  });

  test.each(Object.entries(DOC_EXAMPLES))(
    "%s: INI and TOML give the same valid table",
    (name, statuses) => {
      const tables = ["importlinter", "toml"].map((ext) => {
        const text = readFileSync(join(FIXTURES, "docs", `${name}.${ext}`), "utf8");
        const config = ext === "toml" ? readToml(Bun.TOML.parse(text)) : readIni(text);
        if (config === undefined || typeof config === "string") {
          throw new Error(`${name}.${ext}: ${String(config)}`);
        }
        const result = convert(config);
        if (typeof result === "string") {
          throw new Error(result);
        }
        expect(result.outcomes.map((o) => o.status)).toEqual(statuses);
        const toml = renderToml(result.draft, { source: "x", root: "." });
        expect(() => parseConfig(toml)).not.toThrow();
        expect([validate(table(toml)), validate.errors ?? []]).toEqual([true, []]);
        return toml;
      });
      expect(tables[0]).toBe(tables[1] ?? "");
    },
  );
});
