---
type: rule
title: FAPI003 router-wiring
description: Every APIRouter with routes is included in an app, and no routers include each other in a cycle.
code: FAPI003
name: router-wiring
severity: error
suppressible: true
autofix: false
status: planned
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/model.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 184]
---

# FAPI003 `router-wiring`

!!! warning "Registered, not implemented yet"

    FAPI003 is registered so that config, suppressions and SARIF already know the code, but it reports nothing yet. Its checks land in [#184](https://github.com/SirCypkowskyy/inwards/issues/184). Turning it on with `extend-select = ["FAPI003"]` is valid and changes nothing until then.

## What it will do

Report an `APIRouter` with routes that no app reaches through `include_router`, routers that include each other in a cycle, and an `include_router` call that runs before the included router's routes are declared. The full design, options included, is in [#184](https://github.com/SirCypkowskyy/inwards/issues/184).

## How it works

FAPI003 belongs to the FastAPI rule family ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)): it is opt-in, and it reads the shared FastAPI model (apps, routers, path operations, `include_router` edges and exception handlers, resolved across files without importing the app). It doesn't report what Ruff's `FAST` rules already do.

## Configuration

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI003"]
```

Like every rule, it takes `modules` in `[tool.inwards.rules.router-wiring]` ([options tables](index.md#opt-in-rules)). A finding will be suppressible inline with `# inwards: ignore[FAPI003] reason="..."` on its line.
