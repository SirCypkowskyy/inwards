---
type: rule
title: FAPI001 endpoint-metadata
description: A FastAPI path operation declares the OpenAPI metadata the project requires.
code: FAPI001
name: endpoint-metadata
severity: error
suppressible: true
autofix: false
status: planned
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/model.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 183]
---

# FAPI001 `endpoint-metadata`

!!! warning "Registered, not implemented yet"

    FAPI001 is registered so that config, suppressions and SARIF already know the code, but it reports nothing yet. Its checks land in [#183](https://github.com/SirCypkowskyy/inwards/issues/183). Turning it on with `extend-select = ["FAPI001"]` is valid and changes nothing until then.

## What it will do

Report a path operation that lacks the OpenAPI metadata the project requires: a summary or docstring, a response model, an explicit status code on `POST` and `DELETE`, a description for each entry in `responses=`, and, when turned on, tags and an `operation_id`. The full design, options included, is in [#183](https://github.com/SirCypkowskyy/inwards/issues/183).

## How it works

FAPI001 belongs to the FastAPI rule family ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)): it is opt-in, and it reads the shared FastAPI model (apps, routers, path operations, `include_router` edges and exception handlers, resolved across files without importing the app). It doesn't report what Ruff's `FAST` rules already do.

## Configuration

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI001"]
```

Like every rule, it takes `modules` in `[tool.inwards.rules.endpoint-metadata]` ([options tables](index.md#opt-in-rules)). A finding will be suppressible inline with `# inwards: ignore[FAPI001] reason="..."` on its line.
