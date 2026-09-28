---
type: rule
title: FAPI002 undocumented-error-response
description: A FastAPI path operation declares every error status code it can produce.
code: FAPI002
name: undocumented-error-response
severity: error
suppressible: true
autofix: false
status: planned
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/model.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 183]
---

# FAPI002 `undocumented-error-response`

!!! warning "Registered, not implemented yet"

    FAPI002 is registered so that config, suppressions and SARIF already know the code, but it reports nothing yet. Its checks land in [#183](https://github.com/SirCypkowskyy/inwards/issues/183). Turning it on with `extend-select = ["FAPI002"]` is valid and changes nothing until then.

## What it will do

Report a path operation that can produce an error status code its OpenAPI entry doesn't declare: an `HTTPException` raised in the endpoint, in a helper or dependency it calls, or a custom exception an app-level handler maps to a status code. The full design, options included, is in [#183](https://github.com/SirCypkowskyy/inwards/issues/183).

## How it works

FAPI002 belongs to the FastAPI rule family ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)): it is opt-in, and it reads the shared FastAPI model (apps, routers, path operations, `include_router` edges and exception handlers, resolved across files without importing the app). It doesn't report what Ruff's `FAST` rules already do.

## Configuration

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI002"]
```

Like every rule, it takes `modules` in `[tool.inwards.rules.undocumented-error-response]` ([options tables](index.md#opt-in-rules)). A finding will be suppressible inline with `# inwards: ignore[FAPI002] reason="..."` on its line.
