---
type: rule
title: FAPI005 route-shadowing
description: No FastAPI path operation is shadowed by an earlier one with the same method, so every route can be reached.
code: FAPI005
name: route-shadowing
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/route-shadowing.ts
timestamp: 2026-10-09T12:00:00Z
related_issues: [186, 184, 224]
---

# FAPI005 `route-shadowing`

## What it does

Opt-in. Reports a path operation that can never be reached because an earlier one answers every request it would:

- **Shadowed:** `GET /users/{id}` is declared before `GET /users/me`. A request for `/users/me` matches the first route, with `id` set to `"me"`, so the second one never runs.
- **Repeated:** the same method and path declared twice. FastAPI keeps both in the OpenAPI schema, but only the first one answers.

The finding sits on the unreachable operation's decorator and names the earlier one with its file and line. It compares full paths across the routers an app includes, using the prefixes of `APIRouter(prefix=...)` and `include_router(..., prefix=...)`.

## Why is this bad

FastAPI matches routes in the order they were added, and the first match wins, without a warning. The docs call it out ("Order matters"). An agent that adds `GET /users/me` below `GET /users/{id}` writes a handler that no request reaches, and a test that calls the handler function directly passes. Ruff checks one file at a time and has no rule for it.

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

from app import users

app = FastAPI()
app.include_router(users.router, prefix="/users")
```

<!-- e2e -->

```python title="app/users.py"
from fastapi import APIRouter

router = APIRouter(tags=["users"])


@router.get("/{user_id}")
async def get_user(user_id: str) -> dict[str, str]:
    return {"id": user_id}


@router.get("/me")
async def get_me() -> dict[str, str]:
    return {"id": "me"}
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/users.py:11:1: FAPI005 `@router.get("/me")` (GET /users/me) can never be reached: `@router.get("/{user_id}")` (GET /users/{user_id}) at app/users.py:6 comes first and matches the same requests, so FastAPI always picks that one.
  fix: Declare the specific route before the one with the path parameter.
    1. Move `@router.get("/me")` (GET /users/me) above `@router.get("/{user_id}")` (GET /users/{user_id}), so the specific path is matched first.
    2. If they are on different routers, include the router with the specific route first: the order of the include_router calls decides.
    3. Don't delete either route to make this finding go away.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI005/
```

Fixed: the literal path comes first.

<!-- e2e -->

```python title="app/users.py"
from fastapi import APIRouter

router = APIRouter(tags=["users"])


@router.get("/me")
async def get_me() -> dict[str, str]:
    return {"id": "me"}


@router.get("/{user_id}")
async def get_user(user_id: str) -> dict[str, str]:
    return {"id": user_id}
```

<!-- e2e -->

```sh
inwards check app
```

## How it works

FAPI005 reads the shared FastAPI model ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)) and the app and router graph of [FAPI003](FAPI003.md). For each app, and for each router that no known app or router includes, it lists the routes in the order FastAPI holds them: the decorators and the `include_router` calls of an app or router in source order, with each included router's routes in place, and the full path of each route made of the prefixes on the way.

A route is reported when, for every method it serves, an earlier route serves that method and matches every path the route matches. Paths compare segment by segment, as Starlette matches them:

- `{id}` and `{id:str}` match any non-empty segment: a literal one, or a parameter of any converter except `path`.
- `{id:int}` matches a segment of digits, so it covers `/items/42` and `/items/{n:int}`, not `/items/new`.
- `{rest:path}` at the end of a path matches everything after it.
- Parameter names don't matter: `/u/{a}` and `/u/{b}` are the same path, and the second is reported as a repeat.
- A segment that mixes text and a parameter (`{name}.json`) covers only an identical segment.

Methods compare per method: `@router.api_route("/a", methods=["GET", "POST"])` is reported only when both `GET` and `POST` are already served above it.

Where it runs:

- **`inwards check`**, `inwards baseline` and the **Stop gate** report both kinds, within and across routers, in the files they check.
- **The PostToolUse hook** and the editor report only what one router in one file shows. Moving a route in one file is a one-file edit; wiring routers into an app is a second edit, so the cross-router findings wait for the Stop gate. A suppression of a cross-router finding still counts as used in the hook.

## How to fix

1. Shadowed: move the specific route above the one with the parameter. The fix names both. When they sit on different routers, include the router with the specific route first.
2. Repeated: decide which of the two is meant, and give the other its own path or method. Don't delete the first one without asking: clients reach it today.

## Fix safety

No automatic fix (`autofix: false`). Which route is meant, and whether a repeat is stale or a mistake, are decisions for the author.

## Configuration

Severity error. Opt-in: turn it on with `extend-select`. It has no options of its own; `modules` works as for every rule ([options tables](index.md#opt-in-rules)).

Every finding sits on the decorator and can be suppressed inline with `# inwards: ignore[FAPI005] reason="..."` on that line.

## Known limitations

Unknown means silent. Nothing is reported when:

- a path, a `methods=` list or a `prefix=` isn't a string literal (a variable, an f-string, a call), or a `**kwargs` may hide one;
- a router keeps its routes in several files, since their order isn't known;
- a segment uses a converter Inwards doesn't know, other than an identical one;
- another inclusion of the same router, under a prefix Inwards can't read or in another app, leaves the route reachable.

More limits:

- **`mount`** isn't followed: a mounted app routes on its own, after the routes of the app it is mounted on.
- **Routes added at runtime** (`app.add_api_route(...)`, `app.router.routes.insert(...)`) aren't seen, and neither are `@router.websocket` routes.
- **Conditional routes** (`if settings.DEBUG:`) count as present.
- **A route written below the `include_router` that includes its router** in the same file is not in the app, as FastAPI copies the routes that exist when the call runs ([FAPI003](FAPI003.md) reports that call). It is left out of the comparison.
- **Trailing slashes**: `/users` and `/users/` are different paths here, as they are for Starlette's matching before its redirect.

## References

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): the FastAPI family, opt-in, and the shared model.
- FastAPI docs, [Path Operation order](https://fastapi.tiangolo.com/tutorial/path-params/#order-matters): "Order matters".
