/**
 * @file FAPI007 `yield-dependency-swallows` (#226): an `except` clause around
 * the `yield` of a dependency that doesn't raise on every path hides the
 * endpoint's error. Covers the rollback case, a bare and a re-raising
 * handler, an HTTPException, a raise on every branch of an `if`, a path that
 * returns, a clause for a narrow exception, a generator that is a context
 * manager or a fixture, and suppressions.
 */
import { describe, expect, test } from "bun:test";
import { checkProject } from "./fixture.ts";

const RULES = '[tool.inwards.rules]\nextend-select = ["FAPI007"]';

/**
 * Checks one module with FAPI007 on.
 *
 * @param body - the module's text.
 * @param edited - true to check it as a per-edit check does.
 * @returns `line message` for each FAPI007 finding.
 */
async function check(body: string, edited = false): Promise<string[]> {
  const files = { "app/__init__.py": "", "app/deps.py": body };
  const found = await checkProject(files, RULES, edited ? "app/deps.py" : undefined);
  return found.filter((d) => d.code === "FAPI007").map((d) => `${d.line} ${d.message}`);
}

/**
 * Builds a `get_db` dependency with the given `except` block.
 *
 * @param handler - the lines of the handler, indented by 8 spaces.
 * @param catches - what the clause catches.
 * @returns the module's text.
 */
function dependency(handler: string, catches = "Exception"): string {
  return `def get_db():
    db = open_session()
    try:
        yield db
    except ${catches}:
${handler}
    finally:
        db.close()
`;
}

describe("FAPI007", () => {
  test("is off by default", async () => {
    const files = {
      "app/__init__.py": "",
      "app/deps.py": dependency("        db.rollback()"),
    };
    expect(await checkProject(files, "")).toEqual([]);
  });

  test("reports an except that rolls back and does not raise, on the except line", async () => {
    expect(await check(dependency("        db.rollback()"))).toEqual([
      "5 `except Exception` around the `yield` in `get_db` never re-raises: an error from the endpoint stops here, so the client gets a 500 and the server has no log of the cause.",
    ]);
  });

  test("passes when the except block ends with a raise", async () => {
    expect(await check(dependency("        db.rollback()\n        raise"))).toEqual([]);
  });

  test("passes when it raises an HTTPException", async () => {
    const handler = '        raise HTTPException(status_code=400, detail="bad") from exc';
    expect(await check(dependency(handler, "ValueError as exc"))).toEqual([]);
  });

  test("passes when every branch of an if raises, fails when one does not", async () => {
    const every =
      "        if retry():\n            raise\n        else:\n            raise RuntimeError()";
    const some = "        if retry():\n            raise\n        log()";
    expect(await check(dependency(every))).toEqual([]);
    expect(await check(dependency(some))).toHaveLength(1);
  });

  test("reports a handler that returns before it raises", async () => {
    expect(await check(dependency("        return\n        raise"))).toHaveLength(1);
  });

  test("reports each except clause that swallows, naming what it catches", async () => {
    const text = `async def get_db():
    try:
        yield 1
    except KeyError:
        log()
    except (ValueError, TypeError) as exc:
        raise
    except Exception as exc:
        log(exc)
`;
    const found = await check(text);
    expect(found).toHaveLength(2);
    expect(found[0]).toStartWith("4 `except KeyError` around");
    expect(found[1]).toStartWith("8 `except Exception as exc` around");
  });

  test("reads an except* clause too", async () => {
    const text = `async def get_db():
    try:
        yield 1
    except* ValueError:
        log()
`;
    const found = await check(text);
    expect(found).toHaveLength(1);
    expect(found[0]).toStartWith("4 `except* ValueError` around");
  });

  test("passes a yield without an except, and an except without a yield in the try", async () => {
    const text = `def a():
    try:
        yield 1
    finally:
        close()


def b():
    try:
        work()
    except Exception:
        log()
    yield 2
`;
    expect(await check(text)).toEqual([]);
  });

  test("ignores a nested function's own yield and try", async () => {
    const text = `def outer():
    def inner():
        try:
            yield 1
        except Exception:
            raise
    return inner


def plain():
    try:
        value = compute()
    except Exception:
        log()
    return value
`;
    expect(await check(text)).toEqual([]);
  });

  test("skips context managers and fixtures, which may swallow on purpose", async () => {
    const text = `import contextlib

import pytest


@contextlib.contextmanager
def scope():
    try:
        yield
    except Exception:
        log()


@pytest.fixture
def db():
    try:
        yield 1
    except Exception:
        log()
`;
    expect(await check(text)).toEqual([]);
  });

  test("reports in a per-edit check too, and a suppression hides it", async () => {
    const body = dependency("        db.rollback()");
    expect(await check(body, true)).toHaveLength(1);
    const quiet = body.replace(
      "    except Exception:",
      '    except Exception:  # inwards: ignore[FAPI007] reason="the middleware logs it"',
    );
    expect(await check(quiet)).toEqual([]);
  });
});
