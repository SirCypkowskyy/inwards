/**
 * @file The two validators the schema tests compare: the JSON Schema for
 * `[tool.inwards]` (and the whole-file schema built from it), compiled with
 * Ajv in strict mode, and Inwards' own parser. Also a merge that turns a docs
 * fragment into a complete config by adding it to a minimal one.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import { parse, stringify } from "smol-toml";
import { parseConfig } from "../../src/config/parse.ts";
import { ConfigError, isRecord } from "../../src/config/toml.ts";

export const REPO: string = resolve(import.meta.dir, "../../../..");
/** The smallest valid config a fragment is merged into. */
export const MINIMAL =
  '[tool.inwards]\nlayers = [{ name = "domain", modules = ["shop.domain"] }]\n';

/** The part of a schema the tests walk. */
export interface Schema {
  properties?: Record<string, Schema>;
  definitions?: Record<string, Schema>;
  items?: Schema;
  allOf?: Schema[];
  // biome-ignore lint/style/useNamingConvention: the JSON Schema keyword is spelled $ref.
  $ref?: string;
  enum?: string[];
  default?: unknown;
}

/**
 * Reads a repository file, or nothing when it doesn't exist.
 *
 * @param path - a repo-relative path.
 * @returns the text, empty when the file is missing.
 */
export function read(path: string): string {
  const full = join(REPO, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

export const schema: Schema = JSON.parse(read("schema/tool-inwards.schema.json"));
const pyprojectSchema: Schema = JSON.parse(read("schema/pyproject.schema.json"));

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addKeyword("markdownDescription");
const validateTable: ValidateFunction = ajv.compile(schema);
const validateFile: ValidateFunction = ajv.compile(pyprojectSchema);

/**
 * Lists a validator's errors as short lines.
 *
 * @param validate - a validator that just ran.
 * @returns one line per error.
 */
function errorsOf(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

/**
 * Validates the `[tool.inwards]` table of a pyproject text with the table schema.
 *
 * @param text - the whole TOML text.
 * @returns the schema's errors, empty when it validates.
 */
export function schemaErrors(text: string): string[] {
  const doc = parse(text);
  const tool = isRecord(doc["tool"]) ? doc["tool"] : {};
  return validateTable(tool["inwards"]) ? [] : errorsOf(validateTable);
}

/**
 * Validates a whole pyproject text with the whole-file schema.
 *
 * @param text - the whole TOML text.
 * @returns the schema's errors, empty when it validates.
 */
export function fileSchemaErrors(text: string): string[] {
  return validateFile(parse(text)) ? [] : errorsOf(validateFile);
}

/**
 * Tells whether the parser accepts a pyproject text.
 *
 * @param text - the whole TOML text.
 * @returns the config error's message, or undefined when it parses.
 * @throws {Error} anything other than a ConfigError, which would be a bug.
 */
export function parserError(text: string): string | undefined {
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
 * Tells whether a parsed TOML value is a table (not an array).
 *
 * @param value - any parsed value.
 * @returns true for a table.
 */
function isTable(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

/**
 * Merges a fragment's `[tool.inwards]` keys into the minimal config.
 *
 * @param fragment - TOML that sets some keys of `[tool.inwards]`.
 * @returns the complete config's text.
 * @throws {Error} when the fragment isn't valid TOML, or its `tool` or
 *   `tool.inwards` isn't a table: merging would silently repair it.
 */
export function merged(fragment: string): string {
  const base = parse(MINIMAL);
  const extra = parse(fragment);
  const baseTool = isRecord(base["tool"]) ? base["tool"] : {};
  if (!(isTable(extra["tool"]) && isTable(extra["tool"]["inwards"] ?? {}))) {
    throw new Error("tool and tool.inwards must be tables");
  }
  const extraTool = extra["tool"];
  const inwards = {
    ...(isRecord(baseTool["inwards"]) ? baseTool["inwards"] : {}),
    ...(isRecord(extraTool["inwards"]) ? extraTool["inwards"] : {}),
  };
  return stringify({ ...extra, tool: { ...extraTool, inwards } });
}
