---
type: rule
title: FAPI008 duplicate-operation-id
description: No two path operations one FastAPI app serves share an explicit operation_id.
code: FAPI008
name: duplicate-operation-id
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/duplicate-operation-id.ts
timestamp: 2026-09-28T22:00:00Z
related_issues: [186, 184, 227]
---

# FAPI008 `duplicate-operation-id`

## What it does

Opt-in. Reports a path operation whose explicit `operation_id=` another path operation of the same app already has. Each app's operations are collected through the [FAPI003](FAPI003.md) graph, across routers and files, in the order the app serves them; the first one keeps the id, and each later one is reported on its decorator, naming the first. The fix gives the first one's file and line.

## Why is this bad

The OpenAPI specification requires every `operationId` to be unique. Client generators (openapi-generator, orval, openapi-ts) turn each id into a method name, so two operations with one id give two methods with one name: the generator fails, renames one (`getOrder1`), or one overwrites the other. FastAPI builds the schema anyway and only logs a `Duplicate Operation ID` warning when `/openapi.json` is first requested, at runtime. The two operations usually live in different routers, often in different files, so review rarely catches it, and Ruff checks one file at a time.

## Example

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI008"]
```

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app import legacy, orders

app = FastAPI()
app.include_router(orders.router, prefix="/orders")
app.include_router(legacy.router, prefix="/v1/orders")
```

<!-- e2e -->

```python title="app/orders.py"
from fastapi import APIRouter

router = APIRouter(tags=["orders"])


@router.get("/{order_id}", operation_id="getOrder")
async def get_order(order_id: int) -> dict[str, int]:
    return {"id": order_id}
```

<!-- e2e -->

```python title="app/legacy.py"
from fastapi import APIRouter

router = APIRouter(tags=["legacy"])


@router.get("/{order_id}", operation_id="getOrder")
async def get_legacy_order(order_id: int) -> dict[str, int]:
    return {"id": order_id}
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/legacy.py:6:1: FAPI008 `get_legacy_order` has operation_id "getOrder", which `get_order` already has in the app `app.main.app`. OpenAPI needs each id once, and a generated client gets two methods with one name.
  fix: Give `get_legacy_order` an operation_id of its own; `get_order` (app/orders.py:6) keeps "getOrder".
    1. Rename the id that fits its endpoint worse, and update the client code or tests that call it by that name.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI008/
```

Fixed: the legacy endpoint gets an id of its own.

<!-- e2e -->

```python title="app/legacy.py"
from fastapi import APIRouter

router = APIRouter(tags=["legacy"])


@router.get("/{order_id}", operation_id="getLegacyOrder")
async def get_legacy_order(order_id: int) -> dict[str, int]:
    return {"id": order_id}
```

<!-- e2e -->

```sh
inwards check app
```

## How it works

FAPI008 reads the shared FastAPI model ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)) and walks each app's routes through the FAPI003 graph, the same walk [FAPI005](FAPI005.md) uses.

- **Per app.** Operations are grouped by `operation_id` within one app. Two apps have two schemas, so the same id on operations of two different apps is fine, and a router included by two apps is checked in each.
- **Explicit, literal ids only.** Only `operation_id="..."` as a string literal counts. An id FastAPI generates, from the function name, path and method or from a `generate_unique_id_function` on the app, a router or an `include_router`, is never read: an explicit id always wins over the function, so explicit ids are the only ones Inwards can compare. An id that isn't a literal (`operation_id=ids.GET_ORDER`, an f-string) is skipped.
- **In the schema only.** An operation left out of the schema, by `include_in_schema=False` on the decorator, its router or an `include_router` above it, doesn't count, since FastAPI doesn't put it in `/openapi.json`.
- **Once per operation.** An operation that clashes in two apps is reported once.

Where it runs:

- **`inwards check`**, `inwards baseline` and the **Stop gate** report it, in the files they check, against the whole project's graph.
- **The PostToolUse hook** and the editor don't: whether two operations end up in one app depends on how the app includes their routers, which one edit doesn't show. A suppression still counts as used there.

## How to fix

1. Give the reported operation an `operation_id` of its own. Keep the id on the operation that clients already call by that name.
2. Update the client code and tests that call the renamed operation by its id.

## Fix safety

No automatic fix (`autofix: false`). Renaming an id renames a method in every generated client, so which one changes is the team's decision.

## Configuration

Severity error. Opt-in: turn it on with `extend-select`. It has no options of its own; `[tool.inwards.rules.duplicate-operation-id]` takes `modules`, as for every rule ([options tables](index.md#opt-in-rules)).

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI008"]
```

Every finding sits on the decorator of the later operation and can be suppressed inline with `# inwards: ignore[FAPI008] reason="..."` on that line.

## Known limitations

- **Generated ids aren't compared.** Two operations without an explicit id can still clash under a custom `generate_unique_id_function`; Inwards doesn't run the function.
- **A router included twice** (under `/v1` and `/v2`) gives each of its explicit ids twice. That isn't reported, because the finding would sit on the one decorator both copies share; FastAPI's own warning covers it.
- **Dynamic wiring** (a router Inwards can't resolve) leaves its operations out of the app, as FAPI003 describes, so a clash with them is missed.
- **Order across files** follows the walk FAPI005 describes: which of two clashing operations comes first can differ from runtime when a route is decorated in a module other than the one that builds its router.

## References

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): the FastAPI family, opt-in, and the shared model.
- [FAPI003](FAPI003.md): the app and router graph the check walks.
- OpenAPI Specification, [Operation Object](https://spec.openapis.org/oas/v3.1.0#operation-object): `operationId` is unique among all operations.
- FastAPI docs, [Path Operation Advanced Configuration](https://fastapi.tiangolo.com/advanced/path-operation-advanced-configuration/) and [Generate Clients](https://fastapi.tiangolo.com/advanced/generate-clients/).
