---
type: rule
title: FAPI009 depends-called
description: Depends(get_db()) calls the dependency where the route is declared and passes its result, instead of passing the dependency for FastAPI to call per request.
code: FAPI009
name: depends-called
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/depends-called.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 228]
---

# FAPI009 `depends-called`

## What it does

Reports `Depends(f(...))` and `Security(f(...))` when `f` is a first-party function whose result can't be a dependency:

- a generator function (it has a `yield`): the call returns a generator;
- an `async def`: the call returns a coroutine;
- a function that returns only literals, `None`, or instances of first-party classes without `__call__`.

`f` is resolved in the same file or through the imports, following re-exports. A factory that returns a function, such as `Depends(require_role("admin"))` whose `require_role` returns an inner `def`, passes; so does a class, and anything Inwards can't read (a third-party function, a return of a local variable). It reads `Annotated[..., Depends(...)]` metadata and every other place a marker appears, such as `dependencies=[Depends(...)]` on a decorator, router or app. A marker in a parameter default (`db=Depends(get_db())`) is left to Ruff's `B008` unless `check-defaults` is on.

## Why is this bad

`Depends` takes the dependency itself; FastAPI calls it on each request, fills its parameters, and runs a generator's cleanup after the response. `Depends(get_db())` calls `get_db` once, when the module is imported, and hands FastAPI the generator object. FastAPI can't call a generator, so declaring the route fails as soon as the module is imported; a coroutine is never awaited on top of that. The parentheses are an easy slip for an agent, and Ruff's `B008` only looks at parameter defaults, so the `Annotated` form FastAPI recommends (and Ruff's `FAST002` asks for) isn't checked by anything else.

## Example

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI009"]
```

<!-- e2e -->

```python title="app/db.py"
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

<!-- e2e -->

```python title="app/routes.py"
from typing import Annotated

from fastapi import APIRouter, Depends

from app.db import get_db

router = APIRouter()


@router.get("/orders")
async def list_orders(db: Annotated[Session, Depends(get_db())]) -> list[int]:
    return []
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/routes.py:11:46: FAPI009 `Depends(get_db())` calls `get_db` where the route is declared and passes FastAPI the generator it returns, which FastAPI can't call as a dependency.
  fix: Pass the function itself: `Depends(get_db)`.
    1. Replace `get_db()` with `get_db`; FastAPI calls the dependency on each request and fills its parameters itself.
    2. If `get_db` needs arguments, make it a factory that returns the dependency function, or give it parameters FastAPI can fill.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI009/
```

Fixed: `Depends` gets the function.

<!-- e2e -->

```python title="app/routes.py"
from typing import Annotated

from fastapi import APIRouter, Depends

from app.db import get_db

router = APIRouter()


@router.get("/orders")
async def list_orders(db: Annotated[Session, Depends(get_db)]) -> list[int]:
    return []
```

<!-- e2e -->

```sh
inwards check app
```

## How to fix

1. Drop the call: `Depends(get_db)`.
2. If the dependency needs arguments, write a factory that returns the dependency function (`def require_role(role): def check(...): ...; return check`), and call the factory: `Depends(require_role("admin"))`.

## Fix safety

No automatic fix (`autofix: false`). Removing the parentheses is almost always right, but when the call passes arguments, the dependency has to change shape.

## Configuration

Opt-in: it reports only when `extend-select` or `select` lists `FAPI009`. Its option, with its default:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI009"]

[tool.inwards.rules.depends-called]
check-defaults = false  # also report Depends(f()) in a parameter default
```

`check-defaults` is off because Ruff's `B008` already reports the inner call in a default. Turn it on in a project that doesn't run Ruff's `B` rules. Like every rule, it also takes `modules` ([options tables](index.md#opt-in-rules)). A finding can be suppressed on the marker's line with `# inwards: ignore[FAPI009] reason="..."`.

## Known limitations

- A function that returns a local variable or the result of another call is assumed to return something callable, and passes.
- An instance of a class with a base Inwards can't see (a third-party base) passes: the base may define `__call__`.
- Only the first argument (or `dependency=`) is read; a marker built through `functools.partial` passes.

## References

- [ADR-037: Framework rule families, opt-in, with their own prefix](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)
- FastAPI: [Dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/), [Advanced Dependencies](https://fastapi.tiangolo.com/advanced/advanced-dependencies/)
- Ruff's `B008` reports a call in a parameter default, `FAST002` a `Depends` default that should be `Annotated`; neither looks inside `Annotated[...]`.
