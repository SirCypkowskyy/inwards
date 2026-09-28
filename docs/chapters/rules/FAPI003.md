---
type: rule
title: FAPI003 router-wiring
description: Every APIRouter with routes is included in an app, and no routers include each other in a cycle.
code: FAPI003
name: router-wiring
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/router-wiring.ts
timestamp: 2026-09-28T18:00:00Z
related_issues: [186, 184]
---

# FAPI003 `router-wiring`

## What it does

Opt-in. Reports three ways a FastAPI router's routes go missing without any error:

- **Unmounted router:** an `APIRouter(...)` bound to a name at module level, with at least one path operation, that no app reaches through `include_router` or `mount`, directly or through other routers. Reported on the `APIRouter(...)` line.
- **Inclusion cycle:** routers that include each other, directly or through others, or a router that includes itself. Each group of routers is reported once, with the whole cycle in the message, on the `include_router` call that closes it.
- **Included before its routes:** in one file, `parent.include_router(child)` at module level runs above a `@child.get(...)` decorator. `include_router` copies the routes that exist when it runs, so the routes below it are missing.

## Why is this bad

An agent adds `app/invoices/router.py` with three endpoints and tests them against the router, but never adds `app.include_router(...)` to `main.py`. The tests pass, and the endpoints don't exist. FastAPI doesn't complain about a router nobody includes, and Ruff checks one file at a time, so nothing else reports it. A cycle, or an inclusion above the routes, gives an app a route set that depends on the order the calls run in.

## Example

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI003"]
```

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app.orders import router as orders

app = FastAPI()
app.include_router(orders.router)
```

<!-- e2e -->

```python title="app/orders/router.py"
from fastapi import APIRouter

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("/{order_id}")
async def get_order(order_id: int) -> dict[str, int]:
    return {"id": order_id}
```

<!-- e2e -->

```python title="app/invoices/router.py"
from fastapi import APIRouter

router = APIRouter(prefix="/invoices", tags=["invoices"])


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: int) -> dict[str, int]:
    return {"id": invoice_id}
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/invoices/router.py:3:10: FAPI003 APIRouter `app.invoices.router.router` has path operations, but no app includes it, directly or through another router, so its routes don't exist at runtime.
  fix: Include `router` in the app or router that serves its siblings.
    1. In app/main.py, which builds the app `app`, where its sibling routers are included: import `app.invoices.router.router` and add `app.include_router(...)` for it.
    2. If it is meant to stay unmounted (a later release, a test-only router), tell the user: they can add it to allow-unmounted in [tool.inwards.rules.router-wiring], or suppress this line with a reason.
    3. Don't delete the router or its routes to make this finding go away.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI003/
```

Fixed: `main.py` includes both routers.

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app.invoices import router as invoices
from app.orders import router as orders

app = FastAPI()
app.include_router(orders.router)
app.include_router(invoices.router)
```

<!-- e2e -->

```sh
inwards check app
```

## How it works

FAPI003 reads the shared FastAPI model ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)) and builds a graph of apps and routers from it:

- **Roots:** every `FastAPI(...)` in the project, including one built inside a factory function such as `create_app()`. With `entrypoints`, only the apps it names.
- **Edges:** each `include_router` and `mount` call. The receiver and the target are resolved across files through the imports, never by importing the app: `router`, `invoices.router` after `from app import invoices`, `invoices_router` after `from app.invoices.router import router as invoices_router`, a re-export in an `__init__.py`, and each name in a list or tuple literal that a `for` loop calls `include_router` on.
- **Receivers Inwards can't find**, such as the `app` parameter of a `register(app)` function: what they include counts as reached, since something includes it.

Files are found by a text pre-filter (`fastapi`, `APIRouter`, `include_router`...) and parsed once. The graph is built only when a checked file holds a router, an app or an `include_router` call.

Where it runs:

- **`inwards check`**, `inwards baseline` and the **Stop gate** report all three kinds, but only in the files they check: a partial run checks its files against the whole project's graph. The Stop gate checks the files the session changed, so a router created or changed in the session blocks if it is still unmounted at the end, and a router that was already unmounted at session start doesn't.
- **The PostToolUse hook** and the editor report only what one file shows: an inclusion above the routes, and a router that includes itself. Creating a router and wiring it into `main.py` are two edits, and blocking the first would be wrong.

The graph is also what the FastAPI rules that need an inclusion path read ([#183](https://github.com/SirCypkowskyy/inwards/issues/183), [#224](https://github.com/SirCypkowskyy/inwards/issues/224), [#227](https://github.com/SirCypkowskyy/inwards/issues/227)): `rules/fastapi/graph.ts`.

## How to fix

1. Unmounted: include the router in the app, or in the parent router where its sibling routers are included. The fix names that module. Don't delete the router.
2. Cycle: remove one of the `include_router` calls the fix lists. Keep the one that goes from the router closer to the app down to its child.
3. Included before its routes: move the `include_router` call below the last decorator of the included router, or into the module that builds the app.

## Fix safety

No automatic fix (`autofix: false`). Where a router belongs, and which inclusion of a cycle is wrong, are design decisions.

## Configuration

Severity error. Opt-in: turn it on with `extend-select`. Its options go in `[tool.inwards.rules.router-wiring]`:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI003"]

[tool.inwards.rules.router-wiring]
entrypoints = ["app.main:app"]
allow-unmounted = ["app.experimental"]
unresolved-includes = "warn"
check-order = true
```

- `entrypoints` (default: every app): the apps unmounted routers are measured from, as `module:name`. The name is the app's variable or the top-level function that builds it (`app.main:create_app`). Other apps, in tests or scripts, then don't count. An entry that names no app counts for nothing.
- `allow-unmounted` (default none): routers that may stay unmounted, as module prefixes or selectors (the grammar of a layer's `modules`) matched against the router's qualified name, such as `app.experimental` or `app.*.internal`.
- `unresolved-includes` (default `"warn"`): what an `include_router` call whose target Inwards can't resolve does. `"warn"` turns every unmounted router into a warning that names the call; `"silent"` drops them.
- `check-order` (default `true`): `false` stops reporting an inclusion above the routes.
- `modules`, as for every rule ([options tables](index.md#opt-in-rules)).

Every finding sits on a line of its own and can be suppressed inline with `# inwards: ignore[FAPI003] reason="..."` on that line. A suppression on an `APIRouter(...)` line counts as used in the hook too, which doesn't report the router.

## Known limitations

- **Dynamic wiring:** `importlib.import_module(...)`, `getattr(m, "router")`, a loop over anything but a literal, a router a factory function returns, entry-point plugins. An `include_router` whose target Inwards can't resolve makes unmounted routers warnings (or nothing, with `"silent"`), never errors on a guess. A library's router (`from fastapi_users import ...`) isn't an unresolved call; it just isn't in the graph.
- **Conditional wiring:** `if settings.DEBUG: app.include_router(debug.router)` counts as included.
- **Routers meant to be unused** (a shared router other packages include, a test-only router, one kept for a later release): use `allow-unmounted` or a suppression with a reason.
- **Apps outside the project** aren't seen: a router a library's app includes is unmounted as far as FAPI003 knows. Use `allow-unmounted` or `ignore` for such code.
- A cycle through dynamic wiring isn't seen. A cycle doesn't hang FastAPI, since inclusion copies routes, but the route set then depends on call order, so it is an error.
- In the Stop gate, a router the session didn't touch isn't reported, even if the session removed its `include_router` call from `main.py`. `inwards check` reports it.

## References

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): the FastAPI family, opt-in, and the shared model.
- FastAPI docs, [Bigger Applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/): `include_router` on apps and routers.
