/**
 * @file A small FastAPI project for the FAPI001 and FAPI002 tests, in memory:
 * files by path, an engine built from a `[tool.inwards.rules]` body, and a
 * check of the whole project that lists what the rules report. Tests override
 * or add files per case, so each shows the code it is about.
 */

import type { Diagnostic } from "../../../src/index.ts";
import { Engine, parseConfig } from "../../../src/index.ts";
import { file, grammars, indexOn } from "../../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]
`;

/**
 * Builds the on-disk view of a project: each file and every directory above it.
 *
 * @param files - file texts by path.
 * @returns what is at each path.
 */
function disk(files: Readonly<Record<string, string>>): Map<string, "file" | "dir"> {
  const kinds = new Map<string, "file" | "dir">();
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      kinds.set(parts.slice(0, i).join("/"), "dir");
    }
    kinds.set(path, "file");
  }
  return kinds;
}

/**
 * Checks a whole project with some rules on, or only one edited file of it,
 * as the per-edit hook does.
 *
 * @param files - file texts by path.
 * @param rules - the `[tool.inwards.rules]` body and any options tables, TOML.
 * @param edited - the one file to check, if not the whole project.
 * @returns every diagnostic, in file order.
 */
export async function checkProject(
  files: Readonly<Record<string, string>>,
  rules: string,
  edited?: string,
): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(`${LAYERS}\n${rules}\n`));
  const project = indexOn(disk(files), new Map(Object.entries(files)));
  if (edited !== undefined) {
    return engine.checkFile(file(edited, files[edited] ?? ""), project);
  }
  const sources = Object.entries(files).map(([path, text]) => file(path, text));
  return engine.checkFiles(sources, project);
}

/**
 * Checks a project and keeps what one rule reports.
 *
 * @param files - file texts by path.
 * @param code - the rule's code.
 * @param options - extra TOML after `extend-select`, such as an options table.
 * @returns `path:line message` for each of the rule's findings.
 */
export async function reported(
  files: Readonly<Record<string, string>>,
  code: string,
  options = "",
): Promise<string[]> {
  const found = await checkProject(
    files,
    `[tool.inwards.rules]\nextend-select = ["${code}"]\n${options}`,
  );
  return found.filter((d) => d.code === code).map((d) => `${d.file}:${d.line} ${d.message}`);
}

/** The top of the router module the FAPI002 tests use, `app/orders.py`. */
export const HEAD: string = `from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

router = APIRouter()
`;

/** An app that includes the orders router and maps `OutOfStock` to 409. */
export const MAIN: string = `from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app import orders
from app.errors import OutOfStock

app = FastAPI()
app.include_router(orders.router)


@app.exception_handler(OutOfStock)
async def out_of_stock(request, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})
`;

/** First-party exceptions: a hierarchy an app handler maps, and an `HTTPException` subclass. */
export const ERRORS: string = `class DomainError(Exception): ...


class OutOfStock(DomainError): ...


class LastItemGone(OutOfStock): ...


class ItemNotFound(HTTPException):
    def __init__(self, item: int) -> None:
        super().__init__(status_code=404, detail=f"item {item}")
`;

/**
 * Checks a project whose router module is `app/orders.py`, with FAPI002 on.
 *
 * @param body - the router module after its imports and `router = APIRouter()`.
 * @param more - other files by path.
 * @param options - the options table's body, TOML.
 * @returns what FAPI002 reports.
 */
export function fapi002(
  body: string,
  more: Readonly<Record<string, string>> = {},
  options = "",
): Promise<string[]> {
  const table =
    options === "" ? "" : `[tool.inwards.rules.undocumented-error-response]\n${options}\n`;
  const files = { "app/__init__.py": "", "app/orders.py": `${HEAD}${body}`, ...more };
  return reported(files, "FAPI002", table);
}

/**
 * Writes a route that raises an exception from `app/errors.py`.
 *
 * @param name - the exception class.
 * @returns the router module's routes.
 */
export function raising(name: string): string {
  return `
from app.errors import ${name}


@router.post("/orders", status_code=201)
async def create_order(id: int) -> OrderOut:
    raise ${name}()
`;
}
