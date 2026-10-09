/**
 * @file FAPI006 `lifespan-events` (#225): `on_event` handlers are a warning,
 * and a handler on an app (or a router an app includes) that sets `lifespan=`
 * is an error, since FastAPI then never runs it. Covers the decorator and
 * `add_event_handler` forms, an app in another file, `on_startup=` and
 * `on_shutdown=`, a router under an app with a lifespan, the per-edit mode
 * and suppressions.
 */
import { describe, expect, test } from "bun:test";
import { checkProject } from "./fixture.ts";

const RULES = '[tool.inwards.rules]\nextend-select = ["FAPI006"]';
const LIFESPAN = `from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app):
    yield


app = FastAPI(lifespan=lifespan)
`;
const PLAIN_APP = "from fastapi import FastAPI\n\napp = FastAPI()\n";

/**
 * Checks a project with FAPI006 on.
 *
 * @param files - file texts by path.
 * @param edited - the one file to check, if not the whole project.
 * @returns `severity code path:line` for each FAPI006 finding, and its message.
 */
async function check(
  files: Record<string, string>,
  edited?: string,
): Promise<{ at: string[]; messages: string[] }> {
  const found = (await checkProject({ "app/__init__.py": "", ...files }, RULES, edited)).filter(
    (d) => d.code === "FAPI006",
  );
  return {
    at: found.map((d) => `${d.severity} ${d.file}:${d.line}`),
    messages: found.map((d) => d.message),
  };
}

describe("FAPI006 without a lifespan", () => {
  test("is off by default", async () => {
    const files = {
      "app/__init__.py": "",
      "app/main.py": `${PLAIN_APP}\n\n@app.on_event("startup")\ndef start(): ...\n`,
    };
    expect(await checkProject(files, "")).toEqual([]);
  });

  test("warns about an on_event handler on its decorator", async () => {
    const { at, messages } = await check({
      "app/main.py": `${PLAIN_APP}\n\n@app.on_event("startup")\ndef start(): ...\n`,
    });
    expect(at).toEqual(["warning app/main.py:6"]);
    expect(messages[0]).toBe(
      '`@app.on_event("startup")` is deprecated: FastAPI replaces startup and shutdown events with a `lifespan=` context manager.',
    );
  });

  test("warns about add_event_handler", async () => {
    const { at, messages } = await check({
      "app/main.py": `${PLAIN_APP}\n\ndef stop(): ...\n\n\napp.add_event_handler("shutdown", stop)\n`,
    });
    expect(at).toEqual(["warning app/main.py:9"]);
    expect(messages[0]).toContain('`app.add_event_handler("shutdown", stop)` is deprecated');
  });

  test("warns about on_startup= and on_shutdown= once each", async () => {
    const { at, messages } = await check({
      "app/main.py":
        "from fastapi import FastAPI\n\napp = FastAPI(\n    on_startup=[print],\n    on_shutdown=[print],\n)\n",
    });
    expect(at).toEqual(["warning app/main.py:4", "warning app/main.py:5"]);
    expect(messages[0]).toContain("`on_startup=` is deprecated");
  });

  test("ignores empty handler lists and None", async () => {
    const { at } = await check({
      "app/main.py":
        "from fastapi import FastAPI\n\napp = FastAPI(on_startup=[], on_shutdown=None, lifespan=None)\n",
    });
    expect(at).toEqual([]);
  });

  test("reports nothing for an app with only a lifespan", async () => {
    expect((await check({ "app/main.py": LIFESPAN })).at).toEqual([]);
  });

  test("ignores on_event on something that is not an app or router", async () => {
    const { at } = await check({
      "app/main.py": `${PLAIN_APP}\n\nbus = object()\n\n\n@bus.on_event("startup")\ndef start(): ...\n`,
    });
    expect(at).toEqual([]);
  });
});

describe("FAPI006 with a lifespan", () => {
  test("is an error on an on_event handler in the same file", async () => {
    const { at, messages } = await check({
      "app/main.py": `${LIFESPAN}\n\n@app.on_event("startup")\ndef start(): ...\n`,
    });
    expect(at).toEqual(["error app/main.py:14"]);
    expect(messages[0]).toBe(
      '`@app.on_event("startup")` never runs: `app` (app/main.py:11) sets `lifespan=`, and FastAPI then ignores event handlers. It\'s all lifespan or all events, not both.',
    );
  });

  test("is an error on the handler when the app is in another file", async () => {
    const { at, messages } = await check({
      "app/main.py": LIFESPAN,
      "app/events.py": 'from app.main import app\n\n\n@app.on_event("shutdown")\ndef stop(): ...\n',
    });
    expect(at).toEqual(["error app/events.py:4"]);
    expect(messages[0]).toContain("`app` (app/main.py:11) sets `lifespan=`");
  });

  test("is an error on on_startup= next to lifespan=, on the keyword", async () => {
    const { at } = await check({
      "app/main.py":
        "from fastapi import FastAPI\n\nasync def lifespan(app): ...\n\n\napp = FastAPI(\n    lifespan=lifespan,\n    on_startup=[print],\n)\n",
    });
    expect(at).toEqual(["error app/main.py:8"]);
  });

  test("is an error on a router handler when an app above it has a lifespan", async () => {
    const files = {
      "app/main.py": `${LIFESPAN}\napp.include_router(users.router)\n`.replace(
        "from fastapi import FastAPI",
        "from fastapi import FastAPI\n\nfrom app import users",
      ),
      "app/users.py":
        'from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.on_event("startup")\ndef start(): ...\n',
    };
    expect((await check(files)).at).toEqual(["error app/users.py:6"]);
  });

  test("stays a warning for a router no app with a lifespan includes", async () => {
    const files = {
      "app/main.py": `${PLAIN_APP.replace("from fastapi", "from app import users\nfrom fastapi")}app.include_router(users.router)\n`,
      "app/users.py":
        'from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.on_event("startup")\ndef start(): ...\n',
    };
    expect((await check(files)).at).toEqual(["warning app/users.py:6"]);
  });

  test("a per-edit check leaves the router case at a warning", async () => {
    const files = {
      "app/main.py": `${LIFESPAN}\napp.include_router(users.router)\n`.replace(
        "from fastapi import FastAPI",
        "from fastapi import FastAPI\n\nfrom app import users",
      ),
      "app/users.py":
        'from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.on_event("startup")\ndef start(): ...\n',
    };
    expect((await check(files, "app/users.py")).at).toEqual(["warning app/users.py:6"]);
  });

  test("an inline suppression on the decorator line hides the finding", async () => {
    const text = `${LIFESPAN}\n\n@app.on_event("startup")  # inwards: ignore[FAPI006] reason="legacy plugin"\ndef start(): ...\n`;
    expect((await check({ "app/main.py": text })).at).toEqual([]);
  });
});
