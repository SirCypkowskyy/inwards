---
type: rule
title: FAPI006 lifespan-events
description: FastAPI apps use a lifespan context manager, not the deprecated on_event handlers, and never both, so every startup and shutdown handler runs.
code: FAPI006
name: lifespan-events
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/lifespan-events.ts
timestamp: 2026-10-09T18:00:00Z
related_issues: [186, 225]
---

# FAPI006 `lifespan-events`

## What it does

Opt-in. Reports the deprecated startup and shutdown events of a FastAPI app or router:

- **Deprecated (warning):** `@app.on_event("startup")`, `@app.on_event("shutdown")`, `app.add_event_handler(...)` and `FastAPI(on_startup=..., on_shutdown=...)` (the same on an `APIRouter`). FastAPI replaces them with the `lifespan=` context manager.
- **Never runs (error):** the same registration on an app that also sets `lifespan=`, or on a router that an app with a `lifespan=` includes. FastAPI runs only the lifespan then, and the handlers are silently ignored.

The finding sits on the registration: the `@app.on_event(...)` decorator, the `add_event_handler` call, or the `on_startup=` / `on_shutdown=` keyword. The receiver can be in another file: a handler in `app/events.py` is matched to the app in `app/main.py` through the project's imports.

## Why is this bad

The FastAPI docs say it plainly: "It's all lifespan or all events, not both." An agent that adds `@app.on_event("startup")` to an app that already has a `lifespan=` writes a handler that never runs. Nothing fails at startup, the connection pool is never opened, and the first request is the one that finds out. Ruff has no rule for it.

## Example

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI006"]
```

<!-- e2e -->

```python title="app/main.py"
from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(lifespan=lifespan)
```

<!-- e2e -->

```python title="app/events.py"
from app.main import app


@app.on_event("startup")
async def connect() -> None:
    print("connecting")
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/events.py:4:1: FAPI006 `@app.on_event("startup")` never runs: `app` (app/main.py:11) sets `lifespan=`, and FastAPI then ignores event handlers. It's all lifespan or all events, not both.
  fix: Move the handler into the lifespan context manager.
    1. Move what this handler does into the lifespan function that is already set.
    2. Write one async lifespan function that takes the app, with the startup code before its `yield` and the shutdown code after it, wrap it with `contextlib.asynccontextmanager`, and pass it as `lifespan=`.
    3. Delete the old handler only after its body has moved: don't remove it to make this finding go away, as its startup or shutdown work would be lost.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI006/
```

Fixed: the startup code moves into the lifespan, before the `yield`.

<!-- e2e -->

```python title="app/main.py"
from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("connecting")
    yield


app = FastAPI(lifespan=lifespan)
```

<!-- e2e -->

```sh
rm app/events.py
inwards check app
```

## How it works

FAPI006 reads the shared FastAPI model ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)): each `on_event` decorator and `add_event_handler` call is recorded with the app or router it is called on, and the receiver is resolved to its `FastAPI(...)` or `APIRouter(...)` call, in this file or another one.

- A registration on an object whose constructor passes `lifespan=` (anything but `None`) is an error.
- A registration on a router is also an error when an app, or a router under one, that includes it passes `lifespan=`. The inclusions come from the app and router graph of [FAPI003](FAPI003.md).
- Any other registration, and any `on_startup=` / `on_shutdown=` that isn't an empty list or `None`, is a warning.

Where it runs:

- **`inwards check`**, `inwards baseline` and the **Stop gate** report all three.
- **The PostToolUse hook** and the editor don't read the router graph: a router's handler is a warning there, and the Stop gate raises it to an error when an app above it has a lifespan.

## How to fix

1. Write one `@asynccontextmanager` function that takes the app: the startup code goes before its `yield`, the shutdown code after it.
2. Pass it as `FastAPI(lifespan=...)`, and delete the `on_event` handlers and `on_startup=` / `on_shutdown=` lists once their bodies have moved.
3. Don't delete a handler to silence the finding: the work it does at startup or shutdown would be lost.

## Fix safety

No automatic fix (`autofix: false`). Merging handlers into a lifespan changes the order startup and shutdown code runs in, which is a decision for the author.

## Configuration

Severity error, with the deprecated-only findings reported as warnings. Opt-in: turn it on with `extend-select`. It has no options of its own; `modules` works as for every rule ([options tables](index.md#opt-in-rules)).

Every finding can be suppressed inline with `# inwards: ignore[FAPI006] reason="..."` on the line of the registration.

## Known limitations

Unknown means silent for the error: a registration stays a warning when

- the app's constructor passes `**kwargs` that may hide a `lifespan=`;
- an `include_router` in the project can't be followed, so the router's parents are unknown.

More limits:

- **A receiver Inwards can't resolve** to a `FastAPI(...)` or `APIRouter(...)` call, such as an app a function receives as a parameter, isn't reported at all.
- **Starlette apps** (`Starlette(on_startup=...)`) aren't read, only `FastAPI` and `APIRouter`.
- **A lifespan set after construction** (`app.router.lifespan_context = ...`) isn't seen.
- **A file that doesn't mention FastAPI** is read only if it spells `on_event` or `add_event_handler`.

## References

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): the FastAPI family, opt-in, and the shared model.
- FastAPI docs, [Lifespan Events](https://fastapi.tiangolo.com/advanced/events/): "It's all lifespan or all events, not both."
