/**
 * @file INW012 `thin-endpoint` on the false-positive classes the #182 corpus
 * run left (#360): server-rendered HTML built with nested `with tag.div():`
 * blocks counts as one statement per markup tree, an `if` or `except` that
 * shows one message and returns answers early like a guard (HTMX form
 * handlers), and a health check, by its path or its name, probes its
 * dependencies without a finding. Each case
 * also shows the work INW012 must still count next to them.
 */
import { describe, expect, test } from "bun:test";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const CONFIG = `[tool.inwards]
layers = [{ name = "api", modules = ["shop"] }]

[tool.inwards.rules]
extend-select = ["INW012"]
`;

const HEAD = `from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from tagflow import tag, text

from shop.db import find_log, get_db
from shop.ui import layout

router = APIRouter()
`;

/**
 * Checks `shop/views.py` with INW012 on and keeps its findings.
 *
 * @param body - the module after its imports and `router = APIRouter()`.
 * @returns `line message` for each INW012 finding.
 */
async function inw012(body: string): Promise<string[]> {
  const engine = await Engine.create(grammars(), parseConfig(CONFIG));
  const path = "shop/views.py";
  const text = `${HEAD}${body}`;
  const disk = new Map<string, "file" | "dir">([
    ["shop", "dir"],
    [path, "file"],
  ]);
  return engine
    .checkFiles([file(path, text)], indexOn(disk, new Map([[path, text]])))
    .filter((d) => d.code === "INW012")
    .map((d) => `${d.line} ${d.message.replace(/ Endpoints parse.*$/u, "")}`);
}

/** A back-office page in the shape of Polar's `email_logs` detail view: a lookup, then markup. */
const PAGE = `

@router.get("/logs/{id}")
async def get_log(id: int) -> None:
    log = await find_log(id)
    if log is None:
        raise HTTPException(status_code=404)
    with layout("Logs"):
        with tag.div(classes="flex flex-col gap-4"):
            with tag.h1(classes="text-4xl"):
                text(log.subject)
            with tag.div(classes="grid"):
                with tag.div(classes="card"):
                    with tag.h2(classes="card-title"):
                        text("Details")
                    with tag.dl():
                        text(log.to_addr)
                        text(log.from_addr)
                        text(log.status)
                with tag.pre():
                    text(log.body)
`;

describe("INW012 on server-rendered HTML (#360)", () => {
  test("a markup tree of with blocks counts as one statement and no nesting", async () => {
    expect(await inw012(PAGE)).toEqual([]);
  });

  test("a with block that binds its value, or holds an assignment, still counts", async () => {
    // `with tag.div() as d:` binds a value and `x = ...` is work, not markup.
    const bound = PAGE.replace(
      'with tag.div(classes="grid"):',
      'with tag.div(classes="grid") as grid:',
    );
    const work = PAGE.replace(
      'text("Details")',
      'total = log.size * 2\n                        text("Details")',
    );
    const nested = "5 levels of nested blocks (max 2)";
    const [b] = await inw012(bound);
    const [w] = await inw012(work);
    expect(b).toContain("`get_log` is an HTTP endpoint with");
    expect(w).toContain(nested);
  });

  test("markup next to real work still reports the work", async () => {
    const loop = PAGE.replace(
      "    with layout",
      "    for line in log.lines:\n        if line.bad:\n            if line.fatal:\n                log.fail()\n    with layout",
    );
    expect(await inw012(loop)).toEqual([
      "13 `get_log` is an HTTP endpoint with 3 levels of nested blocks (max 2) and 1 loop over data.",
    ]);
  });
});

describe("INW012 on HTMX form handlers (#360)", () => {
  /** A form handler in the shape of Polar's `startup_program_uninvite`: each error is a toast and a return. */
  const Form = `

@router.post("/orgs/{id}/uninvite")
async def uninvite(request: Request, id: int) -> Response | None:
    url = request.url_for("orgs:detail", id=id)
    if not settings.PROGRAM_ENABLED:
        await add_toast(request, "The program is not configured.", "error")
        return None
    org = await find_org(id)
    if org is None:
        await add_toast(request, "Organization not found.", "error")
        return None
    try:
        await program.uninvite(org)
    except ProgramError as e:
        await add_toast(request, str(e), "error")
        return None
    await add_toast(request, "Uninvited.", "success")
    return redirect(url)
`;

  test("an if or except that shows one message and returns answers early, like a guard", async () => {
    expect(await inw012(Form)).toEqual([]);
  });

  test("a branch that does two things before it returns still counts", async () => {
    // An `await audit(id)` in each error branch is work: three branches again.
    const work = Form.replaceAll('"error")\n', '"error")\n        await audit(id)\n');
    expect(await inw012(work)).toEqual([
      "13 `uninvite` is an HTTP endpoint with 17 statements (max 10) and 3 branches (max 2).",
    ]);
  });
});

describe("INW012 on health checks (#360)", () => {
  const Probe = `
    await session.execute(select(1))
    await cache.ping()
    return {"status": "ok"}
`;

  test("an endpoint whose path or name says health check isn't reported", async () => {
    for (const route of [
      '@router.get("/healthz")\nasync def healthz(',
      '@router.get("/internal/readyz")\nasync def probe(',
      '@router.get("/")\nasync def health_check(',
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: three small checks, in order for the message
      expect(await inw012(`\n\n${route}session: AsyncSession = Depends(get_db)):${Probe}`)).toEqual(
        [],
      );
    }
  });

  test("the same body on another path is reported", async () => {
    expect(
      await inw012(
        `\n\n@router.get("/status/orders")\nasync def order_status(session: AsyncSession = Depends(get_db)):${Probe}`,
      ),
    ).toEqual([
      "13 `order_status` is an HTTP endpoint with direct calls (`session.execute`, `select`).",
    ]);
  });
});
