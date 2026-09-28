/**
 * @file FAPI006 `lifespan-events` (#225): an `on_event` handler alone is a
 * warning, and an error on the handler when its app sets `lifespan=` in
 * another file; an app with only `lifespan=` reports nothing. Constructor
 * keywords, `add_event_handler`, routers and receivers Inwards can't resolve
 * are covered too, and so is the per-edit check.
 */
import { describe, expect, test } from "bun:test";
import { checkProject, reported } from "./fixture.ts";

const LIFESPAN = `from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app):
    yield


app = FastAPI(lifespan=lifespan)
`;

const PLAIN = "from fastapi import FastAPI\n\napp = FastAPI()\n";

const EVENTS = `from app.main import app


@app.on_event("startup")
async def connect():
    ...
`;

/**
 * Checks a project with FAPI006 on.
 *
 * @param files - file texts by path, besides `app/__init__.py`.
 * @returns `path:line severity message` for each FAPI006 finding.
 */
async function fapi006(files: Record<string, string>): Promise<string[]> {
  const all = { "app/__init__.py": "", ...files };
  const found = await checkProject(all, '[tool.inwards.rules]\nextend-select = ["FAPI006"]');
  return found
    .filter((d) => d.code === "FAPI006")
    .map((d) => `${d.file}:${d.line} ${d.severity} ${d.message}`);
}

describe("FAPI006", () => {
  test("is off by default", async () => {
    const files = { "app/__init__.py": "", "app/main.py": PLAIN, "app/events.py": EVENTS };
    expect(await checkProject(files, "")).toEqual([]);
  });

  test("warns about on_event alone, on the decorator", async () => {
    expect(await fapi006({ "app/main.py": PLAIN, "app/events.py": EVENTS })).toEqual([
      'app/events.py:4 warning `app.on_event("startup")` registers a startup or shutdown handler through the deprecated events API; FastAPI replaces them with one `lifespan=` context manager.',
    ]);
  });

  test("is an error on the handler when the app in another file sets lifespan=", async () => {
    expect(await fapi006({ "app/main.py": LIFESPAN, "app/events.py": EVENTS })).toEqual([
      'app/events.py:4 error `app.on_event("startup")` never runs: `app` sets `lifespan=` (app/main.py:11), and FastAPI then ignores startup and shutdown events.',
    ]);
  });

  test("reports nothing for an app with only lifespan=", async () => {
    expect(await fapi006({ "app/main.py": LIFESPAN })).toEqual([]);
  });

  test("reads on_startup= and add_event_handler in the app's own file", async () => {
    const main = `${LIFESPAN.replace("lifespan=lifespan", "lifespan=lifespan, on_shutdown=[close]")}
app.add_event_handler("startup", connect)
`;
    expect(await fapi006({ "app/main.py": main })).toEqual([
      "app/main.py:11 error `on_shutdown=` never runs: `app` sets `lifespan=` (app/main.py:11), and FastAPI then ignores startup and shutdown events.",
      'app/main.py:13 error `app.add_event_handler("startup")` never runs: `app` sets `lifespan=` (app/main.py:11), and FastAPI then ignores startup and shutdown events.',
    ]);
    const plain = "from fastapi import FastAPI\n\napp = FastAPI(on_startup=[connect])\n";
    expect(await fapi006({ "app/main.py": plain })).toEqual([
      "app/main.py:3 warning `on_startup=` registers a startup or shutdown handler through the deprecated events API; FastAPI replaces them with one `lifespan=` context manager.",
    ]);
  });

  test("warns about a router's handler, and skips receivers it can't resolve", async () => {
    const router = `from fastapi import APIRouter

router = APIRouter()


@router.on_event("shutdown")
def close(): ...


def register(app):
    @app.on_event("startup")
    def go(): ...
`;
    expect(await fapi006({ "app/main.py": LIFESPAN, "app/routes.py": router })).toEqual([
      'app/routes.py:6 warning `router.on_event("shutdown")` registers a startup or shutdown handler through the deprecated events API; FastAPI replaces them with one `lifespan=` context manager.',
    ]);
  });

  test("treats lifespan=None as no lifespan", async () => {
    const main = `${PLAIN.replace("FastAPI()", "FastAPI(lifespan=None)")}${EVENTS.replace("from app.main import app\n", "")}`;
    expect((await fapi006({ "app/main.py": main }))[0]).toStartWith("app/main.py:6 warning");
  });

  test("reports the error in a per-edit check of the handler's file", async () => {
    const files = { "app/__init__.py": "", "app/main.py": LIFESPAN, "app/events.py": EVENTS };
    const found = await checkProject(
      files,
      '[tool.inwards.rules]\nextend-select = ["FAPI006"]',
      "app/events.py",
    );
    expect(found.map((d) => `${d.code}:${d.severity}`)).toEqual(["FAPI006:error"]);
  });

  test("is suppressed on the decorator's line", async () => {
    const events = EVENTS.replace(
      '@app.on_event("startup")',
      '@app.on_event("startup")  # inwards: ignore[FAPI006] reason="moved in #12"',
    );
    expect(await reported({ "app/main.py": LIFESPAN, "app/events.py": events }, "FAPI006")).toEqual(
      [],
    );
  });
});
