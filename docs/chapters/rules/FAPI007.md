---
type: rule
title: FAPI007 yield-dependency-swallows
description: A dependency with yield re-raises what its except clauses catch, so an error in the endpoint is not hidden from the server.
code: FAPI007
name: yield-dependency-swallows
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/yield-dependency-swallows.ts
timestamp: 2026-10-09T18:00:00Z
related_issues: [186, 226]
---

# FAPI007 `yield-dependency-swallows`

## What it does

Opt-in. Reports an `except` clause around the `yield` of a generator function that neither re-raises nor raises another exception:

```python
def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:   # reported: no raise on any path
        db.rollback()
    finally:
        db.close()
```

The finding sits on the `except` line. It passes when every path through the clause raises: a `raise` in the block, an `if` / `else` whose branches all raise, a `with` whose body raises, or a `try` that raises in its `finally`. An `except` that logs and then re-raises passes, and so does one that raises an `HTTPException` or a subclass.

## Why is this bad

A dependency with `yield` sees the exceptions raised in the endpoint. When its `except` block ends without raising, the error stops there: the client gets a 500 and the server has no log of the cause (FastAPI docs, "Dependencies with yield"). The rollback in the block feels like proper handling, which is why the pattern is common in code an agent writes. Ruff has no rule for it.

## Example

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI007"]
```

<!-- e2e -->

```python title="app/db.py"
class Session:
    def rollback(self) -> None: ...

    def close(self) -> None: ...


def new_session() -> Session:
    return Session()
```

<!-- e2e -->

```python title="app/deps.py"
from collections.abc import Iterator

from app.db import Session, new_session


def get_db() -> Iterator[Session]:
    db = new_session()
    try:
        yield db
    except Exception:
        db.rollback()
    finally:
        db.close()
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/deps.py:10:5: FAPI007 `except Exception` around the `yield` in `get_db` never re-raises: an error from the endpoint stops here, so the client gets a 500 and the server has no log of the cause.
  fix: Re-raise the exception at the end of the except block.
    1. Finish the except block with `raise`, after the cleanup it does (a rollback, say), so FastAPI sees the error.
    2. If the client should get another status, raise an HTTPException (`raise HTTPException(...) from exc`) instead of returning quietly.
    3. Don't drop the except block to make this finding go away: the cleanup in it is needed.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI007/
```

Fixed: the rollback stays and the error goes on.

<!-- e2e -->

```python title="app/deps.py"
from collections.abc import Iterator

from app.db import Session, new_session


def get_db() -> Iterator[Session]:
    db = new_session()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
```

<!-- e2e -->

```sh
inwards check app
```

## How it works

FAPI007 reads one function at a time, with no call graph and no FastAPI model. For each function that has a `yield` of its own (not one in a nested function), it looks at the `try` statements whose body holds the `yield`, and checks each of their `except` clauses (`except*` too). A clause is reported unless some statement in it raises on every path, as the syntax shows.

The rule reads any first-party generator, not only the functions passed to `Depends(...)`: a dependency module often doesn't import FastAPI, and a project-wide search for the use would make the per-edit check slow. A file is parsed only when it spells both `yield` and `except`.

Two kinds of generator are skipped, because swallowing is correct in them: those decorated with `contextmanager` or `asynccontextmanager` (a context manager that suppresses an error does it on purpose), and those decorated with `fixture` (a test fixture never sees the test's exception).

## How to fix

1. End the `except` block with `raise`, after the cleanup it does, so FastAPI sees the error and logs it.
2. If the client should get another status, raise an `HTTPException` from the block.
3. Don't remove the `except` block: its cleanup (a rollback, say) is needed.

## Fix safety

No automatic fix (`autofix: false`). Whether the error should reach the client unchanged or become an `HTTPException` is a decision for the author.

## Configuration

Severity error. Opt-in: turn it on with `extend-select`. It has no options of its own; `modules` works as for every rule ([options tables](index.md#opt-in-rules)).

Every finding can be suppressed inline with `# inwards: ignore[FAPI007] reason="..."` on the `except` line.

## Known limitations

- **Generators that aren't dependencies** are reported too when they yield once: a plain `def line(): try: yield ... except ...: log()` that nothing throws into never sees an endpoint's error. Suppress it inline, or decorate it if it is a context manager. A generator that yields more than once, or inside a `for` or `while`, is a stream and is skipped, since a dependency yields once; a dependency that yields on two branches (`if x: yield a` / `else: yield b`) is skipped with them.
- **A handler that raises through a call** (`fail(exc)` where `fail` always raises) isn't a `raise` to Inwards, so it is reported.
- **A `raise` that only some paths reach** (`if x: raise`) is reported; one on every branch of an `if` / `else` passes.
- **A clause for a narrow exception** (`except KeyError:`) is checked like any other: errors of other types still go through, but this one is swallowed.
- **`return` in the clause** before a `raise` ends the path without raising and is reported.
- **Measured on the corpus** ([#182](https://github.com/SirCypkowskyy/inwards/issues/182), [chapter 6](../06-Constraints-and-Quality.md#precision-of-the-opt-in-rules)): 4 findings before streams were skipped, all false positives (Polar's server-sent events, Saleor's discount iterator), and none after.

## References

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): the FastAPI family, opt-in, and the shared model.
- FastAPI docs, [Dependencies with yield](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/).
