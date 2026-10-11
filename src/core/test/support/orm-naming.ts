/**
 * @file Fixtures and helpers the INW016 `orm-naming` tests share: a layered
 * config, the SQLAlchemy imports most cases start with, and runs of the
 * engine that keep INW016's findings as `path:line:column message` lines.
 * No assertions; each test file decides what to expect.
 */
import type { Diagnostic } from "../../src/index.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "./helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`;

export const HEAD = `from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, MetaData, Table
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

`;

/** The path most cases check. */
export const MODELS = "shop/infrastructure/models.py";

/**
 * Checks some files with a rules table.
 *
 * @param files - file text by path.
 * @param rules - the rules table and any options tables, TOML.
 * @param whole - true for a whole-project run.
 * @returns every diagnostic.
 */
export async function checkOrm(
  files: Readonly<Record<string, string>>,
  rules: string,
  whole = false,
): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(`${LAYERS}\n${rules}\n`));
  const texts = new Map(Object.entries(files));
  const kinds = new Map<string, "file" | "dir">([...texts.keys()].map((p) => [p, "file"]));
  const sources = [...texts].map(([path, text]) => file(path, text));
  return engine.check(sources, indexOn(kinds, texts), undefined, { whole }).diagnostics;
}

/**
 * Checks files with INW016 on and keeps its findings.
 *
 * @param files - file text by path.
 * @param options - the `[tool.inwards.rules.orm-naming]` body, TOML.
 * @param whole - true for a whole-project run.
 * @returns `path:line:column message` for each INW016 finding.
 */
export async function inw016(
  files: Readonly<Record<string, string>>,
  options = "",
  whole = false,
): Promise<string[]> {
  const table = `[tool.inwards.rules.orm-naming]\n${options}\n`;
  const found = await checkOrm(
    files,
    `[tool.inwards.rules]\nextend-select = ["INW016"]\n${table}`,
    whole,
  );
  return found
    .filter((d) => d.code === "INW016")
    .map((d) => `${d.file}:${d.line}:${d.column} ${d.message}`);
}

/**
 * Checks `MODELS` alone, after `HEAD`.
 *
 * @param body - the module after `HEAD`.
 * @param options - the options table's body.
 * @returns the findings, as `inw016` gives them, without the path.
 */
export async function models(body: string, options = ""): Promise<string[]> {
  const found = await inw016({ [MODELS]: `${HEAD}${body}` }, options);
  return found.map((line) => line.slice(MODELS.length + 1));
}

/** The line in `HEAD` + body where a body's first line lands. */
export const FIRST: number = HEAD.split("\n").length;
