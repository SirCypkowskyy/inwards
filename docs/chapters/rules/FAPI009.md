---
type: rule
title: FAPI009 depends-called
description: Depends and Security get the dependency function, not the result of calling it at import time.
code: FAPI009
name: depends-called
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/depends-called.ts
timestamp: 2026-10-09T18:00:00Z
related_issues: [186, 228]
---

# FAPI009 `depends-called`

## What it does

Opt-in. Reports `Depends(f(...))` and `Security(f(...))` where `f` is a first-party function that a call cannot turn into something FastAPI can call per request:

- a **generator** function (it has a `yield`): the call returns a generator object;
- an **`async def`** function: the call returns a coroutine that nothing awaits;
- a function whose every `return` is a plain value (a string, a number, a list, a dict, `None`...), or that returns nothing.

It works wherever the call is written: an argument default, `Annotated[T, Depends(f())]`, or `dependencies=[Depends(f())]`. The finding sits on the `Depends(...)` call.

A factory passes: `Depends(require_role("admin"))` where `require_role` returns an inner function is the documented way to pass arguments to a dependency.

## Why is this bad

`Depends(get_db())` runs `get_db()` once, when the module is imported, and hands FastAPI the result. FastAPI expects a function to call for each request; with a generator or a plain value it either fails at startup or, worse, shares one object across all requests. Ruff's B008 only looks at argument defaults, so the recommended `Annotated[Session, Depends(get_db())]` form (the form Ruff's FAST002 recommends) isn't checked by anything.

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
class Session:
    def close(self) -> None: ...


def new_session() -> Session:
    return Session()
```

<!-- e2e -->

```python title="app/deps.py"
from collections.abc import Iterator

from app.db import Session, new_session


def get_db() -> Iterator[Session]:
    db = new_session()
    try:
        yield db
    finally:
        db.close()
```

<!-- e2e -->

```python title="app/users.py"
from typing import Annotated

from fastapi import APIRouter, Depends

from app.db import Session
from app.deps import get_db

router = APIRouter()


@router.get("/users")
async def list_users(db: Annotated[Session, Depends(get_db())]) -> list[str]:
    return []
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/users.py:12:45: FAPI009 `Depends(get_db())` calls `get_db` once, when the module is imported, and passes its result: `get_db` is a generator function (the call returns a generator object), so FastAPI never gets a function to call per request.
  fix: Pass the function: `Depends(get_db)`.
    1. Remove the parentheses: `Depends(get_db)` hands FastAPI the function, which it calls for each request.
    2. If `get_db` needs arguments, don't call it here: make it a factory that returns the dependency function, or give the dependency parameters FastAPI resolves itself.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI009/
```

Fixed: pass the function.

<!-- e2e -->

```python title="app/users.py"
from typing import Annotated

from fastapi import APIRouter, Depends

from app.db import Session
from app.deps import get_db

router = APIRouter()


@router.get("/users")
async def list_users(db: Annotated[Session, Depends(get_db)]) -> list[str]:
    return []
```

<!-- e2e -->

```sh
inwards check app
```

## How it works

FAPI009 reads the shared FastAPI model ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)), which records every `Depends(...)` and `Security(...)` call of a file whose callee is FastAPI's (under any import alias). When the dependency argument is itself a call, the callee's name is resolved through the model: in the same file, or one hop through the project's imports (`from app.deps import get_db`, `deps.get_db`). Only a first-party function is read.

The function is judged from its own body, leaving out nested functions:

- a `yield` makes it a generator;
- `async def` without `yield` makes it a coroutine function;
- otherwise every `return` is looked at, and the call is reported only when each one returns a literal (a string, number, list, tuple, set, dict, comprehension, comparison, `not`, `True`, `False`, `None`) or returns nothing.

## How to fix

1. Remove the parentheses: `Depends(get_db)`. FastAPI calls the function for each request.
2. If the dependency needs arguments, make a factory that returns the dependency function (`def require_role(role): def check(...): ...; return check`), or give the dependency parameters of its own that FastAPI resolves.

## Fix safety

No automatic fix (`autofix: false`). Dropping the parentheses is usually right, but a function that was meant as a factory needs a different shape.

## Configuration

Severity error. Opt-in: turn it on with `extend-select`. It has no options of its own; `modules` works as for every rule ([options tables](index.md#opt-in-rules)).

Every finding can be suppressed inline with `# inwards: ignore[FAPI009] reason="..."` on the first line of the `Depends(...)` call.

## Known limitations

Unknown means silent. Nothing is reported when:

- the callee isn't a first-party function (a library's, a class, a lambda, a name Inwards can't resolve);
- the function is decorated, since a decorator may change what it returns;
- some `return` is a call, a name, an attribute or anything else that might be callable (`return RoleChecker(role)` is a class instance with `__call__`, a pattern FastAPI supports);
- the dependency is passed by `*args` or `**kwargs`.

More limits:

- **Only one hop**: a name re-exported through several modules is followed, but the callee's own calls aren't.
- **A function that returns `None` on purpose** (a stub) is reported like any other.
- **`Depends` from another library** with the same name isn't confused with FastAPI's: only the qualified `fastapi` names count.

## References

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): the FastAPI family, opt-in, and the shared model.
- FastAPI docs, [Dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/): "you only give `Depends` a single parameter... you don't call it directly".
