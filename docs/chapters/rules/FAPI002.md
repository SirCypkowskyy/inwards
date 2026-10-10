---
type: rule
title: FAPI002 undocumented-error-response
description: A FastAPI path operation can produce an error status code, directly, through a helper or dependency, or through an app's exception handler, that its OpenAPI entry doesn't declare.
code: FAPI002
name: undocumented-error-response
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/undocumented-error-response.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 183, 242]
---

# FAPI002 `undocumented-error-response`

## What it does

Reports a FastAPI path operation that can produce an error status code (4xx by default) that its OpenAPI entry doesn't declare. One finding per endpoint, on its decorator, lists the codes and where each one comes from, so the claim can be checked. A code counts as produced, in rings:

| Ring | Source |
|---|---|
| 0 | `raise HTTPException(404)` or `HTTPException(status_code=404)` in the endpoint, and `return JSONResponse(..., status_code=404)` (any FastAPI or Starlette response class) |
| 1 | The same, in a function of the same file the endpoint calls by name, or in a dependency given as `Depends(fn)` or `Annotated[T, Depends(fn)]` |
| 2 | The same, in a first-party function or dependency imported from another module, read lazily. `dependencies=[Depends(...)]` on the decorator, the `APIRouter(...)`, an `include_router(...)` or `FastAPI(...)` counts for every route under it |
| 3 | A raised first-party exception that an app's exception handler answers with a literal status code, looked up through the exception's base classes as Starlette does; and an `HTTPException` subclass whose `__init__` fixes the code |

Rings 1 and 2 follow at most `max-depth` calls (2 by default). A code is an int literal, a `status.HTTP_*` constant from FastAPI or Starlette, an `HTTPStatus` member, or a first-party module-level constant holding one.

A code counts as declared when `responses=` holds it (an int or string key, or `"4XX"`, `"5XX"` or `"default"`) on the decorator, on the route's `APIRouter(...)`, on an `include_router(...)` that leads to it, or on `FastAPI(...)`; `**NAME` of a module-level dict and `openapi_extra={"responses": {...}}` count too. FastAPI documents 422 itself for an operation that takes parameters, so FAPI002 does too unless `explicit-422 = "report"`.

## Why is this bad

FastAPI builds the schema from what the code declares, and it can't see a `raise` ([fastapi#9124](https://github.com/fastapi/fastapi/issues/9124): declare it in `responses=`). An agent adds a 404 in a helper, or a domain error an app handler turns into a 409, without touching the decorator. The generated client then has no branch for the error, and the frontend finds out in production.

## Example

With the three layers from [INW001](INW001.md#example), turn FAPI002 on:

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]

[tool.inwards.rules]
extend-select = ["FAPI002"]
```

A service raises a domain error, and the app maps it to 409:

<!-- e2e -->

```python title="shop/infrastructure/db.py"
import shop.domain.order


class OrderOut: ...


class OutOfStock(Exception): ...


def reserve(order: OrderOut) -> None:
    raise OutOfStock()
```

<!-- e2e -->

```python title="shop/infrastructure/app.py"
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from shop.infrastructure import orders
from shop.infrastructure.db import OutOfStock

app = FastAPI()
app.include_router(orders.router)


@app.exception_handler(OutOfStock)
async def out_of_stock(request: Request, exc: OutOfStock) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": "Out of stock"})
```

An endpoint loads the order through a helper that raises 404, then reserves it:

<!-- e2e -->

```python title="shop/infrastructure/orders.py"
from fastapi import APIRouter, HTTPException

from shop.infrastructure.db import OrderOut, reserve

router = APIRouter(prefix="/orders", tags=["orders"])


def load_or_404(order_id: int) -> OrderOut:
    raise HTTPException(status_code=404, detail="No such order")


@router.post("/{order_id}/confirm", status_code=200, summary="Confirm an order")
async def confirm_order(order_id: int) -> OrderOut:
    order = load_or_404(order_id)
    reserve(order)
    return order
```

<!-- e2e -->

```sh
inwards check
```

<!-- e2e -->

```text
shop/infrastructure/orders.py:12:1: FAPI002 `confirm_order` can return 404 and 409, which its OpenAPI entry doesn't declare.
  fix: Declare 404 and 409 in `responses=` on `@router.post("/{order_id}/confirm")`.
    1. `confirm_order` can return 404 (from `load_or_404` at shop/infrastructure/orders.py:9) and 409 (from `OutOfStock` raised at shop/infrastructure/db.py:11, handled in shop/infrastructure/app.py:11), but its OpenAPI entry declares none of them.
    2. Add `responses={404: {"description": "..."}, 409: {"description": "..."}}` to the decorator (with a "model" where the error has a body), or to `APIRouter(...)` if every route shares them.
    3. Don't remove the `raise`, and don't catch the error only to silence this finding: clients generated from the schema need to know the error exists.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI002/
```

Fixed: the decorator declares both errors.

<!-- e2e -->

```python title="shop/infrastructure/orders.py"
from fastapi import APIRouter, HTTPException

from shop.infrastructure.db import OrderOut, reserve

router = APIRouter(prefix="/orders", tags=["orders"])


def load_or_404(order_id: int) -> OrderOut:
    raise HTTPException(status_code=404, detail="No such order")


@router.post(
    "/{order_id}/confirm",
    status_code=200,
    summary="Confirm an order",
    responses={
        404: {"description": "No such order"},
        409: {"description": "A product is out of stock"},
    },
)
async def confirm_order(order_id: int) -> OrderOut:
    order = load_or_404(order_id)
    reserve(order)
    return order
```

<!-- e2e -->

```sh
inwards check
```

## How to fix

1. Check each code against its source: the finding names the file and line of every `raise` or handler.
2. Declare the codes in `responses=`, with a `description` and, where the error has a body, a `model`. Put them on the `APIRouter(...)` or the `include_router(...)` when every route under it shares them.
3. Don't delete the `raise` or catch the error just to make the finding go away.

## Fix safety

No automatic fix (`autofix: false`). The description and the error model are part of the API.

## Configuration

Opt-in: it reports only when `extend-select` or `select` lists `FAPI002`. Its options, with their defaults:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI002"]

[tool.inwards.rules.undocumented-error-response]
codes = "4xx"                         # or "4xx-5xx"
max-depth = 2                         # calls followed into helpers and dependencies, 0 to 8
report-direct-raises = true           # false leaves raises in the endpoint itself to Ruff FAST004
handled-counts-as-documented = false  # true: codes from app exception handlers count as declared
explicit-422 = "ignore"               # "report": a raised 422 must be declared too
```

An unknown key or a wrong value is a config error that names the key. Like every rule, it also takes `modules` ([options tables](index.md#opt-in-rules)). A finding can be suppressed on the decorator's line with `# inwards: ignore[FAPI002] reason="..."`.

Ruff's `FAST004` (in review) covers ring 0 with same-file `responses=`. When it ships, `report-direct-raises = false` keeps the two from reporting the same `raise`.

## Known limitations

Unknown means silent: FAPI002 prefers a missed finding to a wrong one.

- A status code it can't read (`HTTPException(code)`), a `responses=` that isn't a literal (`responses=build()`), a decorator with `**kwargs`, or an inclusion it can't resolve (`include_router(getattr(m, "router"))`, a router a factory returns, `include_router(r, **opts)`) makes that code or endpoint unknown, and nothing is reported for it. One unresolved inclusion anywhere makes every route on a router unknown. Inclusions are read from the app and router graph FAPI003 uses ([`graph.ts`](FAPI003.md)), so a loop over a literal list of routers counts.
- Methods on injected objects (`svc.place()`) aren't followed; neither are third-party code, `getattr` dispatch or anything the app does at runtime (routes added in loops, an overridden `app.openapi()`, middleware).
- There's no flow analysis: a `raise` counts if it is in the function, even on a branch this endpoint never takes. An `except X` around a call subtracts only first-party exceptions that are `X` or inherit from it.
- Exception handlers count only on the apps that serve the route: the app it is declared on, or each app that includes its router, directly or through other routers. A handler on another app (a worker's health-check app, say) doesn't count, and neither does one on the app that mounts the route's app, since a mounted app handles its own exceptions.
- Handlers are read from `@app.exception_handler(X)`, `app.add_exception_handler(X, h)` (also in a `for` loop over a list or tuple literal of exceptions) and `exception_handlers=` on `FastAPI(...)`. That table can be a dict, a name bound to one in the same file, or an `"exception_handlers"` entry in a dict splatted into `FastAPI(**kwargs)`, including a dict that a caller in the same file passes to an app factory. A `**kwargs` whose dict sets other keys still hides the app's other keywords, and its routes stay unknown.
- A raised custom exception counts for nothing on an app with a registration Inwards can't read: a loop over a dict of exceptions, or a splatted dict that comes from another file, is changed in place (`kwargs.update(...)`), or belongs to a factory no caller in the file reaches. The same goes for a class that inherits from a third-party exception, whose handler Inwards may not see. A handler for a builtin or third-party class, such as an `Exception` catch-all, is read but maps no code: catch-alls often pick the code by the exception's type inside.
- A generator function called by name (the body of a `StreamingResponse`) isn't read, since the call doesn't run it.
- Where several inclusions lead to one router, a code declared on any of them counts.
- To find what sits above a router, FAPI002 reads every FastAPI file of the project once per check. In the per-edit hook it does so only for a route with a code its own decorator and router don't declare.

## References

- [ADR-037: Framework rule families, opt-in, with their own prefix](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)
- FastAPI: [Additional Responses in OpenAPI](https://fastapi.tiangolo.com/advanced/additional-responses/), [Handling Errors](https://fastapi.tiangolo.com/tutorial/handling-errors/)
- [fastapi/fastapi#9124](https://github.com/fastapi/fastapi/issues/9124), [astral-sh/ruff#25120](https://github.com/astral-sh/ruff/pull/25120) (`FAST004`)
