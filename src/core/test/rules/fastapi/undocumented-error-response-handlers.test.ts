/**
 * @file FAPI002 ring 3 with the handler registrations #242 added: a loop
 * over a list literal of exceptions registers each of them, and an
 * `exception_handlers` table splatted into `FastAPI(**kwargs)` counts, from a
 * module dict or from a same-file caller of an app factory. Only the
 * handlers of the apps that serve a route count: one on another app doesn't.
 */
import { describe, expect, test } from "bun:test";
import { checkProject, ERRORS, fapi002, HEAD, raising, reported } from "./fixture.ts";

/** A handler that maps what it is registered for to 409, for the #242 fixtures. */
const CONFLICT = `

async def conflict(request, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})
`;

/** The imports of an app module that registers `conflict` itself. */
const APP_HEAD = `from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app import orders
from app.errors import OutOfStock
${CONFLICT}`;

const ERRORS_FILE = `from fastapi import HTTPException\n\n${ERRORS}`;

/** What FAPI002 reports for a route raising `OutOfStock`, with 409 undeclared. */
const REPORTED_409 = [
  "app/orders.py:10 `create_order` can return 409, which its OpenAPI entry doesn't declare.",
];

describe("FAPI002 ring 3: looped and splatted registrations, handlers per app (#242)", () => {
  test("a loop over a list literal of exceptions registers each of them", async () => {
    const main = `${APP_HEAD}
app = FastAPI()
app.include_router(orders.router)

for exc in [KeyError, OutOfStock]:
    app.add_exception_handler(exc, conflict)
`;
    const files = { "app/main.py": main, "app/errors.py": ERRORS_FILE };
    expect(await fapi002(raising("OutOfStock"), files)).toEqual(REPORTED_409);
    expect(await fapi002(raising("LastItemGone"), files)).toEqual(REPORTED_409);
    const handled = "handled-counts-as-documented = true";
    expect(await fapi002(raising("OutOfStock"), files, handled)).toEqual([]);
    // A loop over something that isn't a literal still could register anything.
    const dynamic = { ...files, "app/main.py": main.replace("[KeyError, OutOfStock]", "ERRORS") };
    expect(await fapi002(raising("OutOfStock"), dynamic)).toEqual([]);
  });

  test("exception_handlers in a dict splatted into FastAPI(**kwargs) counts", async () => {
    const module = `${APP_HEAD}
KWARGS = {"exception_handlers": {Exception: conflict, OutOfStock: conflict}}
app = FastAPI(title="Shop", **KWARGS)
app.include_router(orders.router)
`;
    const files = { "app/main.py": module, "app/errors.py": ERRORS_FILE };
    expect(await fapi002(raising("OutOfStock"), files)).toEqual(REPORTED_409);
    // The dict passed to an app factory by a caller in the same file, as in prefect.
    const factory = `${APP_HEAD}

def create_app(kwargs: dict | None = None) -> FastAPI:
    kwargs = kwargs or {}
    app = FastAPI(title="Shop", **kwargs)
    app.include_router(orders.router)
    return app


application = create_app(kwargs={"exception_handlers": {Exception: conflict, OutOfStock: conflict}})
`;
    expect(await fapi002(raising("OutOfStock"), { ...files, "app/main.py": factory })).toEqual(
      REPORTED_409,
    );
    const named = {
      ...files,
      "app/main.py": module.replace("**KWARGS", 'exception_handlers=KWARGS["exception_handlers"]'),
    };
    expect(await fapi002(raising("OutOfStock"), named)).toEqual([]);
  });

  test("a splat Inwards can't read makes that app's handlers unknown", async () => {
    const main = `${APP_HEAD}
app = FastAPI(**settings.app_kwargs())
app.include_router(orders.router)
app.add_exception_handler(OutOfStock, conflict)
`;
    const files = { "app/main.py": main, "app/errors.py": ERRORS_FILE };
    expect(await fapi002(raising("OutOfStock"), files)).toEqual([]);
    const plain = { ...files, "app/main.py": main.replace("**settings.app_kwargs()", "") };
    expect(await fapi002(raising("OutOfStock"), plain)).toEqual(REPORTED_409);
  });

  test("a handler on a second app doesn't cover a route mounted only on the first", async () => {
    const main =
      "from fastapi import FastAPI\n\nfrom app import orders\n\napp = FastAPI()\napp.include_router(orders.router)\n";
    const health = `${APP_HEAD}
health = FastAPI()
health.add_exception_handler(OutOfStock, conflict)
`;
    const files = { "app/main.py": main, "app/health.py": health, "app/errors.py": ERRORS_FILE };
    expect(await fapi002(raising("OutOfStock"), files)).toEqual([]);
    // Once the second app includes the router too, its handler applies.
    const both = {
      ...files,
      "app/health.py": `${health}health.include_router(orders.router)\n`,
    };
    expect(await fapi002(raising("OutOfStock"), both)).toEqual(REPORTED_409);
    // The same holds in a per-edit check of the router module.
    const rules = '[tool.inwards.rules]\nextend-select = ["FAPI002"]';
    const project = {
      "app/__init__.py": "",
      "app/orders.py": `${HEAD}${raising("OutOfStock")}`,
      ...files,
    };
    expect(await checkProject(project, rules, "app/orders.py")).toEqual([]);
  });

  test("a route declared on an app gets only that app's handlers", async () => {
    const own = `${APP_HEAD}
from app.errors import OutOfStock as Gone

app = FastAPI()
other = FastAPI()
other.add_exception_handler(Gone, conflict)


@app.post("/orders", status_code=201)
async def create_order(id: int) -> dict:
    raise Gone()
`;
    const files = { "app/__init__.py": "", "app/main.py": own, "app/errors.py": ERRORS_FILE };
    expect(await reported(files, "FAPI002")).toEqual([]);
    const shared = { ...files, "app/main.py": own.replace("other.add", "app.add") };
    expect(await reported(shared, "FAPI002")).toHaveLength(1);
  });
});
