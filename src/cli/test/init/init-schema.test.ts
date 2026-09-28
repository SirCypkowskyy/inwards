/**
 * @file Every config `inwards init --style` writes validates against the JSON
 * Schema for `[tool.inwards]` (#51) and parses. A preset that drifted from the
 * schema would give users a config their editor flags on day one.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseConfig, VERSION } from "@inwards/core";
import Ajv from "ajv";
import { configTable, STYLE_NAMES, STYLES } from "../../src/init/styles.ts";

const REPO = resolve(import.meta.dir, "../../../..");
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addKeyword("markdownDescription");
const validate = ajv.compile(
  JSON.parse(readFileSync(join(REPO, "schema/tool-inwards.schema.json"), "utf8")),
);

/**
 * Picks `tool.inwards` out of a parsed TOML document.
 *
 * @param doc - the parsed document.
 * @returns the table, or undefined when it isn't there.
 */
function inwardsTable(doc: unknown): unknown {
  const tool = typeof doc === "object" && doc !== null ? Reflect.get(doc, "tool") : undefined;
  return typeof tool === "object" && tool !== null ? Reflect.get(tool, "inwards") : undefined;
}

test.each([...STYLE_NAMES])("the %s preset's config validates and parses", (name) => {
  const table = configTable(STYLES[name], {
    pkg: "my_app",
    root: "src",
    version: VERSION,
    ignore: ["tests", "migrations"],
    shapes: true,
    eol: "\n",
  });
  expect(() => parseConfig(table)).not.toThrow();
  expect([validate(inwardsTable(Bun.TOML.parse(table))), validate.errors ?? []]).toEqual([
    true,
    [],
  ]);
});
