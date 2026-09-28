---
type: rule
title: FAPI005 route-shadowing
description: No FastAPI path operation is unreachable behind an earlier route with the same method that matches its path.
code: FAPI005
name: route-shadowing
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/route-shadowing.ts
timestamp: 2026-09-28T22:00:00Z
related_issues: [186, 184, 224]
---

# FAPI005 `route-shadowing`

## What it does

Opt-in. Reports a path operation that can never run, because a route before it with the same method matches every request it would:

- **Shadowed:** `@router.get("/users/{user_id}")` above `@router.get("/users/me")`. `/users/me` matches `{user_id}` first, so `read_me` is never called.
- **Duplicate:** the same method and path declared twice. Only the first one runs.

Both are checked on one router in one file, and across routers on the full path an app serves: the `prefix=` of each `include_router` and `APIRouter(...)` on the way, joined. The finding sits on the decorator of the route that never runs, and names the earlier route; the fix gives that route's file and line.

## Why is this bad

FastAPI tries routes in the order they are declared and included, takes the first match, and says nothing about the rest. The FastAPI tutorial calls this out under "Order matters". The shadowed endpoint still shows up in the OpenAPI schema and in its own unit tests against the function, so nothing fails until a client calls it and gets the other endpoint's answer, often a 422 because `me` isn't an `int`. Ruff checks one file at a time and has no rule for this.

## Example

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI005"]
```

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app import admin, users

app = FastAPI()
app.include_router(users.router, prefix="/users")
app.include_router(admin.router, prefix="/users")
```

<!-- e2e -->

```python title="app/users.py"
from fastapi import APIRouter

router = APIRouter(tags=["users"])


@router.get("/{user_id}")
async def read_user(user_id: int) -> dict[str, int]:
    return {"id": user_id}


@router.get("/me")
async def read_me() -> dict[str, str]:
    return {"name": "me"}
```

<!-- e2e -->

```python title="app/admin.py"
from fastapi import APIRouter

router = APIRouter(tags=["admin"])


@router.get("/stats")
async def user_stats() -> dict[str, int]:
    return {"users": 0}
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/admin.py:6:1: FAPI005 `user_stats` (GET /users/stats) never runs: `read_user` (GET /users/{user_id}) comes before it and matches the same requests, and FastAPI uses the first route that matches.
  fix: Include the router that declares `user_stats` before the one that declares `read_user` (app/users.py:6), or give one of them another path.
    1. FastAPI tries routes in the order they are declared and included: a literal path such as /users/me must come before a parameter path such as /users/{user_id}.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI005/

app/users.py:11:1: FAPI005 `read_me` (GET /me) never runs: `read_user` (GET /{user_id}) comes before it and matches the same requests, and FastAPI uses the first route that matches.
  fix: Move `read_me` above `read_user` (app/users.py:6), so the more specific path is tried first.
    1. FastAPI tries routes in the order they are declared and included: a literal path such as /users/me must come before a parameter path such as /users/{user_id}.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI005/
```

The first finding needs both files: `/users/stats` is shadowed only because both routers are included under `/users`. The second is visible in `users.py` alone, so it names the router's own paths.

Fixed: `read_me` comes first, and the app includes the admin router before the users router.

<!-- e2e -->

```python title="app/users.py"
from fastapi import APIRouter

router = APIRouter(tags=["users"])


@router.get("/me")
async def read_me() -> dict[str, str]:
    return {"name": "me"}


@router.get("/{user_id}")
async def read_user(user_id: int) -> dict[str, int]:
    return {"id": user_id}
```

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app import admin, users

app = FastAPI()
app.include_router(admin.router, prefix="/users")
app.include_router(users.router, prefix="/users")
```

<!-- e2e -->

```sh
inwards check app
```

## How it works

FAPI005 reads the shared FastAPI model ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)).

- **Order.** On one app or router, routes run in source order, and an `include_router` call puts the included router's routes where the call is. Across apps, each app's routes are walked through the [FAPI003](FAPI003.md) graph from the app down, so a router included by two apps is checked in each.
- **Matching.** Paths are compared segment by segment. A literal segment matches itself, `{name}` any one non-empty segment, `{name:int}` digits, and any other convertor only the same convertor. Parameter names don't matter: `/users/{id}` and `/users/{user_id}` are the same path. A path with a `{name:path}` parameter, or a segment that mixes text and a parameter (`/files/{name}.txt`), is only reported as an exact duplicate.
- **Methods.** The two routes must share a method. A `GET` route also answers `HEAD`. An `api_route` whose `methods=` isn't a list of string literals is skipped.
- **What is skipped.** A route whose path, or some `prefix=` above it, isn't a string literal (`prefix=settings.API_PREFIX`), or where a `**kwargs` may set the prefix. Inwards reports nothing rather than guess the value.

Where it runs:

- **`inwards check`**, `inwards baseline` and the **Stop gate** report both kinds, in the files they check, against the whole project's graph.
- **The PostToolUse hook** and the editor report only what one file shows: two routes on the same router in that file. Whether two routers end up under the same prefix is a question about `main.py` as well.

## How to fix

1. Shadowed on one router: move the literal route (`/users/me`) above the parameter route (`/users/{user_id}`).
2. Shadowed across routers: include the router with the literal route first, or give one of the routers another prefix.
3. Duplicate: keep one of the two routes. If both are needed, give the later one another path or method.

Don't delete the endpoint that never runs just to make the finding go away: it usually exists because a client needs it.

## Fix safety

No automatic fix (`autofix: false`). Moving an include can shadow other routes in turn, and which of two duplicates to keep is a design decision.

## Configuration

Severity error. Opt-in: turn it on with `extend-select`. It has no options of its own; `[tool.inwards.rules.route-shadowing]` takes `modules`, as for every rule ([options tables](index.md#opt-in-rules)).

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI005"]
```

Every finding sits on the decorator of the route that never runs and can be suppressed inline with `# inwards: ignore[FAPI005] reason="..."` on that line.

## Known limitations

- **Unknown order across files.** A route decorated on an app or router in a module other than the one that builds it (`@app.get` in a module that imports `app`) runs when that module is imported, which Inwards can't see. It is placed after the routes of the building file, in file path order.
- **Conditional routes:** two routes in the two branches of an `if` are both counted, so a duplicate across the branches is reported.
- **Dynamic wiring** (a router Inwards can't resolve, a non-literal prefix) leaves the pairs it touches unchecked, as FAPI003 describes.
- **A router included twice** (`/v1` and `/v2`) is checked under each prefix, but a route is never compared with its own copy.
- **Mounted apps** (`app.mount("/sub", subapp)`) match their own routes and are checked as their own app.

## References

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): the FastAPI family, opt-in, and the shared model.
- [FAPI003](FAPI003.md): the app and router graph the cross-router check walks.
- FastAPI docs, [Path Parameters, Order matters](https://fastapi.tiangolo.com/tutorial/path-params/#order-matters).
