---
type: rule
title: FAPI001 endpoint-metadata
description: A FastAPI path operation in the OpenAPI schema lacks metadata the project requires, such as a summary, a response model or an explicit status code.
code: FAPI001
name: endpoint-metadata
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/endpoint-metadata.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 183]
---

# FAPI001 `endpoint-metadata`

## What it does

Reports a FastAPI path operation (`@router.get(...)`, `@app.post(...)`, `@router.api_route(...)`) whose OpenAPI entry lacks metadata the project requires. One finding per endpoint, on its decorator, lists everything missing. By default it requires:

- a summary: `summary=`, or a docstring (FastAPI turns it into the description, and the summary then falls back to the function name);
- a response model: `response_model=`, or a return annotation FastAPI can build a schema from, which `Response` and its subclasses aren't. A `status_code=204` route is exempt;
- an explicit `status_code=` on `POST` and `DELETE`, since 200 is rarely right for a create or a delete;
- a `description` in every entry of `responses=`.

Tags and `operation_id` can be required too (see [Configuration](#configuration)). Routes with `include_in_schema=False`, on the decorator or on their `APIRouter(...)`, have no OpenAPI entry and are skipped.

## Why is this bad

The OpenAPI schema is the contract a frontend and every generated client are built from, and FastAPI fills it only from what the code declares. An endpoint without a summary shows its function name, one without a response model shows an empty schema, and a create that answers 200 tells the client nothing happened. Agents add endpoints fast and rarely come back for the metadata.

## Example

With the three layers from [INW001](INW001.md#example), turn FAPI001 on:

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]

[tool.inwards.rules]
extend-select = ["FAPI001"]
```

An agent adds an endpoint that creates an order:

<!-- e2e -->

```python title="shop/infrastructure/orders.py"
from fastapi import APIRouter

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("/")
async def create_order(body: OrderIn):
    ...
```

<!-- e2e -->

```sh
inwards check
```

<!-- e2e -->

```text
shop/infrastructure/orders.py:6:1: FAPI001 `create_order` (POST /) has no summary, explicit status code or response model in its OpenAPI metadata.
  fix: Declare the missing OpenAPI metadata on `@router.post("/")`.
    1. Add `summary="..."` (or a docstring) and `status_code=201` to `@router.post("/")`, and a return annotation or `response_model=...`.
    2. Write a summary that says what the endpoint does, not the function name; declare the model the endpoint really returns.
    3. If the project doesn't want this metadata, ask the user to change [tool.inwards.rules.endpoint-metadata]; don't edit [tool.inwards] yourself.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI001/
```

Fixed: the endpoint says what it does, what it returns and which status it answers with.

<!-- e2e -->

```python title="shop/infrastructure/orders.py"
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/orders", tags=["orders"])


class OrderIn(BaseModel):
    product_id: int


class OrderOut(BaseModel):
    id: int


@router.post("/", status_code=201, summary="Place an order")
async def create_order(body: OrderIn) -> OrderOut:
    return OrderOut(id=1)
```

<!-- e2e -->

```sh
inwards check
```

## How to fix

1. Add what the finding lists to the decorator: `summary="..."` or a docstring, `status_code=`, `"description"` in each `responses=` entry.
2. Declare the model the endpoint returns, as a return annotation or `response_model=`. Returning a `Response` directly gives FastAPI nothing to document.
3. If the project doesn't want a check, turn it off in `[tool.inwards.rules.endpoint-metadata]` rather than adding placeholder metadata.

## Fix safety

No automatic fix (`autofix: false`). A summary and a status code are decisions about the API, not text to generate.

## Configuration

Opt-in: it reports only when `extend-select` or `select` lists `FAPI001`. Its options, with their defaults:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI001"]

[tool.inwards.rules.endpoint-metadata]
require-summary = "summary-or-docstring"  # or "summary" (summary= itself), or false
require-response-model = true             # response_model= or a usable return annotation
require-status-code = ["post", "delete"]  # methods that need an explicit status_code=
require-response-fields = ["description"] # keys every responses= entry needs: description, model, content
require-tags = false                      # tags= on the route, its router, or an include_router above it
require-operation-id = false              # an explicit operation_id=, for generated clients
```

`false`, or `[]` for a list, turns a check off. An unknown key or a wrong value is a config error that names the key. Like every rule, it also takes `modules` ([options tables](index.md#opt-in-rules)). A finding can be suppressed on the decorator's line with `# inwards: ignore[FAPI001] reason="..."`.

## Known limitations

- A decorator with `**kwargs` is skipped: the metadata may be in there.
- `require-tags` counts tags given on an `include_router(...)` in another file; an inclusion Inwards can't resolve (a router in a loop, say) makes it stay quiet.
- It checks that a summary exists, not that it is good.
- A router's `include_in_schema=False` on an `include_router(...)` elsewhere is followed only through inclusions Inwards can resolve.
- Routes added at runtime (`add_api_route`, loops over config) aren't seen.
- **An app that serves no schema** (`FastAPI(openapi_url=None)`) is skipped with every route it declares, like `include_in_schema=False`.
- **Measured on the corpus** ([#182](https://github.com/SirCypkowskyy/inwards/issues/182), [chapter 6](../06-Constraints-and-Quality.md#precision-of-the-opt-in-rules)): 22 findings before the `openapi_url` rule, 21 after, all looked at: 19 true positives (a `POST` or `DELETE` with no explicit status code, a route with no summary) and 2 on the tiny apps Polar's tests build ([#362](https://github.com/SirCypkowskyy/inwards/issues/362)). Polar's 450 endpoints and fastapi-clean-example's 15 aren't seen at all ([#358](https://github.com/SirCypkowskyy/inwards/issues/358)).

## References

- [ADR-037: Framework rule families, opt-in, with their own prefix](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)
- FastAPI: [Path Operation Configuration](https://fastapi.tiangolo.com/tutorial/path-operation-configuration/), [Response Model](https://fastapi.tiangolo.com/tutorial/response-model/)
- Ruff's `FAST001` reports a *redundant* `response_model`; FAPI001 reports a missing one.
