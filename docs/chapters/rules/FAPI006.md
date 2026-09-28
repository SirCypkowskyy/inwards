---
type: rule
title: FAPI006 lifespan-events
description: A FastAPI app registers startup or shutdown handlers through the deprecated events API, or next to a lifespan handler that makes FastAPI ignore them.
code: FAPI006
name: lifespan-events
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/lifespan-events.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 225]
---

# FAPI006 `lifespan-events`

## What it does

Reports startup and shutdown handlers registered through FastAPI's deprecated events API:

- `@app.on_event("startup")` and `@app.on_event("shutdown")`, on an app or an `APIRouter`;
- `app.add_event_handler("startup", handler)`;
- `FastAPI(on_startup=[...])` and `FastAPI(on_shutdown=[...])`.

Alone, each one is a **warning**: FastAPI deprecated them in favour of one `lifespan=` context manager. On an app that also sets `lifespan=`, each one is an **error** on the handler: FastAPI then runs only the lifespan, so the handlers never run. The app is found across files through the imports, so a handler in `app/events.py` on the `app` that `app/main.py` builds with `lifespan=` is reported in `app/events.py`.

## Why is this bad

FastAPI's docs say it plainly: "It's all lifespan or all events, not both." An app that sets `lifespan=` ignores every `on_event` handler, without an error or a log line. An agent that adds a startup hook the way older tutorials show, in a project that already has a lifespan, writes code that never runs: the cache is never warmed, the connection pool is never closed. Type checkers flag `on_event` as deprecated, but none of them knows that the app in another file has a lifespan.

## Example

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI006"]
```

The app closes its database engine in a lifespan:

<!-- e2e -->

```python title="app/main.py"
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


app = FastAPI(lifespan=lifespan)
```

<!-- e2e -->

```python title="app/db.py"
engine = None
```

An agent adds a startup handler in another file:

<!-- e2e -->

```python title="app/events.py"
from app.db import engine
from app.main import app


@app.on_event("startup")
async def create_tables() -> None:
    await engine.create_all()
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/events.py:5:1: FAPI006 `app.on_event("startup")` never runs: `app` sets `lifespan=` (app/main.py:14), and FastAPI then ignores startup and shutdown events.
  fix: Move the handler into `app`'s lifespan function.
    1. Move the handler's code into the app's lifespan function: startup code before its `yield`, shutdown code after it.
    2. Then delete the event registration.
    3. If the project keeps the events on purpose, ask the user before suppressing this; don't edit [tool.inwards] yourself.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI006/
```

Fixed: the startup code runs in the lifespan, before its `yield`, and `app/events.py` is gone.

<!-- e2e -->

```python title="app/main.py"
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    await engine.create_all()
    yield
    await engine.dispose()


app = FastAPI(lifespan=lifespan)
```

<!-- e2e -->

```sh
rm app/events.py
inwards check app
```

## How to fix

1. Move the handler's body into the lifespan function: startup code before its `yield`, shutdown code after it.
2. Delete the `on_event`, `add_event_handler`, `on_startup=` or `on_shutdown=` registration.
3. With no lifespan yet, write one (`@asynccontextmanager async def lifespan(app)`) and move every event handler of the app into it at once: FastAPI runs either the lifespan or the events.

## Fix safety

No automatic fix (`autofix: false`). Moving code into the lifespan changes when it runs relative to the rest of the startup, which a person should check.

## Configuration

Opt-in: it reports only when `extend-select` or `select` lists `FAPI006`. It takes no options besides `modules` ([options tables](index.md#opt-in-rules)). The warnings and the errors share the code, so `severity = { FAPI006 = "warning" }` makes both warnings. A finding can be suppressed on the registration's line with `# inwards: ignore[FAPI006] reason="..."`.

## Known limitations

- A registration on a receiver Inwards can't resolve to a FastAPI app or router, such as the `app` parameter of a `register(app)` function, isn't reported.
- A router's handlers get the warning only. Whether the app that includes the router sets `lifespan=` would need the inclusion graph.
- An app whose constructor takes `**kwargs` may get its lifespan from there; its handlers are then warnings, not errors.
- A lifespan set after construction (`app.router.lifespan_context = ...`) isn't seen.

## References

- [ADR-037: Framework rule families, opt-in, with their own prefix](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)
- FastAPI: [Lifespan Events](https://fastapi.tiangolo.com/advanced/events/)
- Ruff has no rule for this; its `FAST` rules don't look at events.
