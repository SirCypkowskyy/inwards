---
type: rule
title: FAPI007 yield-dependency-swallows
description: A FastAPI dependency with yield has an except around its yield that can end without raising, so it swallows what the endpoint raised.
code: FAPI007
name: yield-dependency-swallows
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/yield-dependency-swallows.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 226]
---

# FAPI007 `yield-dependency-swallows`

## What it does

Reports an `except` clause around the `yield` of a dependency with `yield` when some path through the clause ends without a `raise`. One finding per clause, on its `except ...:` line.

A dependency is recognised by its shape, per function, without looking for the `Depends(...)` that uses it: an undecorated generator function (`def` or `async def`) with exactly one `yield`, outside any loop. The file doesn't have to mention FastAPI, so a `get_db` in `app/db.py` is checked too. A clause passes when every path through it raises: a bare `raise`, `raise HTTPException(...)`, or any other exception. The rule follows `if`/`elif`/`else`, `try` and `with`, and treats a loop or `match` with a `raise` in it as raising. A clause that handles only `GeneratorExit` is left alone.

## Why is this bad

FastAPI runs the code after a dependency's `yield` once the response is ready, and throws the endpoint's exception in at the `yield`. An `except` there that neither re-raises nor raises something else swallows it. FastAPI's docs describe what happens next: the client gets a 500 Internal Server Error, even when the endpoint raised an `HTTPException` with a 404, and the server has no log of the error. An agent that writes the familiar `try: yield db` / `except: db.rollback()` pattern ships an API whose errors disappear.

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
def get_db():
    db = SessionLocal()
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
app/db.py:5:5: FAPI007 `except Exception:` in `get_db` can end without raising, so it swallows what the endpoint raised at the `yield`: the client gets a 500, even for an HTTPException, and the server logs nothing.
  fix: End `except Exception:` in `get_db` with a `raise`.
    1. Keep the cleanup (a rollback, say), then re-raise with a bare `raise`, or raise an `HTTPException` that says what went wrong.
    2. Put cleanup that must always run in `finally:` rather than in `except`.
    3. If the dependency swallows the error on purpose, ask the user before suppressing this; don't edit [tool.inwards] yourself.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI007/
```

Fixed: the rollback stays, and the exception goes on to FastAPI.

<!-- e2e -->

```python title="app/db.py"
def get_db():
    db = SessionLocal()
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

## How to fix

1. End the clause with a bare `raise`, after the cleanup.
2. Or raise an `HTTPException` (or a subclass) that tells the client what went wrong.
3. Put cleanup that must always run in `finally:`, which needs no `except` at all.

## Fix safety

No automatic fix (`autofix: false`). Whether to re-raise or to answer with a specific status is a decision about the API.

## Configuration

Opt-in: it reports only when `extend-select` or `select` lists `FAPI007`. It takes no options besides `modules` ([options tables](index.md#opt-in-rules)). A finding can be suppressed on the `except` line with `# inwards: ignore[FAPI007] reason="..."`.

## Known limitations

- A dependency is found by its shape, so a plain generator of the same shape (one `yield`, not in a loop, no decorator) that is never a dependency is checked too. Generators that yield in a loop, such as streaming responses, and `@contextmanager` or `@pytest.fixture` functions are left out.
- A dependency with two `yield`s, or decorated with something else, isn't checked.
- A call that always raises, such as `sys.exit()` or a helper that raises, doesn't count as a `raise`.
- A loop or `match` with any `raise` in it counts as raising, even when some path through it doesn't.

## References

- [ADR-037: Framework rule families, opt-in, with their own prefix](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)
- FastAPI: [Dependencies with yield and except](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/#dependencies-with-yield-and-except)
- Ruff's `S110` reports `except Exception: pass` anywhere; it doesn't know that a dependency's clause sees the endpoint's exceptions, and a clause that does something before it swallows passes it.
