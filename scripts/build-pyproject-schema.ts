/**
 * @file Builds `schema/pyproject.schema.json`, a schema for a whole
 * `pyproject.toml` that checks only `[tool.inwards]` and leaves every other
 * table alone. Editors that attach schemas per file, such as Taplo, need it:
 * Taplo ignores a rule's `keys` when it associates a schema, so the table
 * schema alone would be applied to the whole file.
 *
 * The file is self-contained: the table schema is copied in as
 * `definitions.inwards`, with its own definitions beside it, so no reference
 * crosses files (Taplo resolves those against each file's `$id` and fetches
 * them). Run `bun run scripts/build-pyproject-schema.ts` after changing the
 * table schema, or with `--check` to fail when the committed file is stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const ROOT = join(import.meta.dir, "..");
const TABLE = join(ROOT, "schema/tool-inwards.schema.json");
const OUT = join(ROOT, "schema/pyproject.schema.json");
const ID = "https://sircypkowskyy.github.io/inwards/schema/pyproject.json";

/**
 * Wraps the table schema into a schema for the whole file.
 *
 * @param table - the parsed `[tool.inwards]` schema.
 * @returns the whole-file schema.
 * @throws {Error} when the table schema has a definition named `inwards`.
 */
export function wrap(table: Record<string, unknown>): Record<string, unknown> {
  // JSON Schema's own keywords start with "$", so they go in through entries.
  const root = Object.fromEntries(
    Object.entries(table).filter(([key]) => !["$schema", "$id", "definitions"].includes(key)),
  );
  const { definitions } = table;
  const shared = typeof definitions === "object" && definitions !== null ? definitions : {};
  if (Object.hasOwn(shared, "inwards")) {
    throw new Error("the table schema already defines 'inwards'");
  }
  return Object.fromEntries([
    ["$schema", table["$schema"]],
    ["$id", ID],
    ["title", "pyproject.toml, checking [tool.inwards] only"],
    [
      "description",
      "A pyproject.toml schema that checks the [tool.inwards] table and nothing else. Other tables are left unchecked.",
    ],
    ["type", "object"],
    [
      "properties",
      {
        tool: {
          type: "object",
          properties: { inwards: Object.fromEntries([["$ref", "#/definitions/inwards"]]) },
        },
      },
    ],
    ["definitions", { ...shared, inwards: root }],
  ]);
}

if (import.meta.main) {
  const table: Record<string, unknown> = JSON.parse(readFileSync(TABLE, "utf8"));
  const text = `${JSON.stringify(wrap(table), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    const stale = readFileSync(OUT, "utf8") !== text;
    process.stderr.write(
      stale ? `${OUT} is stale: run bun run scripts/build-pyproject-schema.ts\n` : "",
    );
    process.exitCode = stale ? 1 : 0;
  } else {
    writeFileSync(OUT, text);
  }
}
