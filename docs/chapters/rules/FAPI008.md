---
type: rule
title: FAPI008 duplicate-operation-id
description: No two path operations of one FastAPI app share an explicit operation_id, so generated clients get one method per operation.
code: FAPI008
name: duplicate-operation-id
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/duplicate-operation-id.ts
timestamp: 2026-10-09T18:00:00Z
related_issues: [186, 184, 227]
---

# FAPI008 `duplicate-operation-id`

## What it does

Opt-in. Reports a path operation whose literal `operation_id=` an earlier operation of the same app already uses. Every operation an app reaches is grouped by its id, across the routers it includes; each one after the first is reported on its decorator, and the message names the first with its file and line.

The same id on the operations of two different apps is fine: an app's OpenAPI schema holds only its own operations.

## Why is this bad

A client generator turns each `operationId` into a method name. Two operations with one id produce two methods with one name, and the generator either fails or keeps one of them. FastAPI only logs "Duplicate Operation ID" when the schema is built at runtime, which a test that never fetches `/openapi.json` doesn't do. Ruff checks one file at a time and has no rule for it.

## Example

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI008"]
```

<!-- e2e -->

```python title="app/users.py"
from fastapi import APIRouter

router = APIRouter()


@router.get("/", operation_id="list_items")
async def list_users() -> list[str]:
    return []
```

<!-- e2e -->

```python title="app/orders.py"
from fastapi import APIRouter

router = APIRouter()


@router.get("/", operation_id="list_items")
async def list_orders() -> list[str]:
    return []
```

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app import orders, users

app = FastAPI()
app.include_router(users.router, prefix="/users")
app.include_router(orders.router, prefix="/orders")
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/orders.py:6:1: FAPI008 `@router.get("/")` uses operation_id "list_items", which `@router.get("/")` at app/users.py:6 already uses: a generated client gets two methods with one name, and FastAPI only warns when it builds the schema.
  fix: Give each operation its own operation_id.
    1. Rename the operation_id of this one, or of `@router.get("/")` at app/users.py:6, so no two operations of the app share one.
    2. If the ids should come from the function names, drop the explicit operation_id= and set generate_unique_id_function on the app instead.
    3. Don't change an id a published client already uses without telling the user: it renames the client's method.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI008/
```

Fixed: each operation has its own id.

<!-- e2e -->

```python title="app/orders.py"
from fastapi import APIRouter

router = APIRouter()


@router.get("/", operation_id="list_orders")
async def list_orders() -> list[str]:
    return []
```

<!-- e2e -->

```sh
inwards check app
```

## How it works

FAPI008 reads the shared FastAPI model ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)) and the app and router graph of [FAPI003](FAPI003.md), the same route lists as [FAPI005](FAPI005.md). For each app, and for each router that no known app or router includes, it lists the operations in the order FastAPI holds them, with each included router's operations in place. The first operation with an id keeps it; a later one with the same id is reported, once, even when several apps or inclusions reach it.

An explicit `operation_id=` overrides `generate_unique_id_function`, so the function on an app or router changes nothing here: only explicit ids are compared.

Where it runs:

- **`inwards check`**, `inwards baseline` and the **Stop gate** report both kinds, within and across routers, in the files they check.
- **The PostToolUse hook** and the editor report only what one router in one file shows. Wiring routers into an app is a second edit, so the cross-router findings wait for the Stop gate. A suppression of a cross-router finding still counts as used in the hook.

## How to fix

1. Give one of the two operations a different `operation_id`, unique within the app.
2. Or drop the explicit ids and let `generate_unique_id_function` build them from the route.
3. Check whether a published client already uses the id before renaming it: it renames the client's method.

## Fix safety

No automatic fix (`autofix: false`). Which of the two keeps the name, and whether a client depends on it, are decisions for the author.

## Configuration

Severity error. Opt-in: turn it on with `extend-select`. It has no options of its own; `modules` works as for every rule ([options tables](index.md#opt-in-rules)).

Every finding sits on the decorator and can be suppressed inline with `# inwards: ignore[FAPI008] reason="..."` on that line.

## Known limitations

Unknown means silent. Nothing is reported when:

- the `operation_id=` isn't a string literal (a variable, an f-string, a call), or a `**kwargs` may hide one;
- the operation has a literal `include_in_schema=False`, since it isn't in the schema;
- the app's inclusion can't be followed, so the router isn't reachable from the app Inwards knows.

More limits:

- **The same operation reached twice** (a router one app includes under two prefixes) shares its id with itself and isn't reported; FastAPI would warn about it.
- **Order across files**: a router that keeps its routes in several files has no known order, so which operation counts as the first is only a convention (file path, then position).
- **`mount`** isn't followed: a mounted app has its own schema.
- **Routes added at runtime** (`app.add_api_route(...)`) aren't seen.

## References

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): the FastAPI family, opt-in, and the shared model.
- FastAPI docs, [Path Operation Advanced Configuration](https://fastapi.tiangolo.com/advanced/path-operation-advanced-configuration/#openapi-operationid): "OpenAPI operationId".
