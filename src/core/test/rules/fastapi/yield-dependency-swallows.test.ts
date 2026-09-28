/**
 * @file FAPI007 `yield-dependency-swallows` (#226): the issue's
 * `try: yield db` / `except Exception: db.rollback()` reports, and the same
 * with a `raise` at the end passes. Paths through `if`, `try` and loops, the
 * shapes that aren't a dependency (a loop, several yields, a decorator), and
 * a file that doesn't mention FastAPI are covered too.
 */
import { describe, expect, test } from "bun:test";
import { checkProject, reported } from "./fixture.ts";

/**
 * Checks one module with FAPI007 on.
 *
 * @param text - the module's source, `app/db.py`.
 * @returns `path:line message` for each FAPI007 finding.
 */
function fapi007(text: string): Promise<string[]> {
  return reported({ "app/__init__.py": "", "app/db.py": text }, "FAPI007");
}

/**
 * Builds a dependency whose `except Exception:` runs the given lines.
 *
 * @param handler - the clause's body, indented by eight spaces.
 * @returns the module's source.
 */
function dependency(handler: string): string {
  return `def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
${handler}
    finally:
        db.close()
`;
}

const SWALLOWS =
  "app/db.py:5 `except Exception:` in `get_db` can end without raising, so it swallows what the endpoint raised at the `yield`: the client gets a 500, even for an HTTPException, and the server logs nothing.";

describe("FAPI007", () => {
  test("is off by default", async () => {
    const files = { "app/__init__.py": "", "app/db.py": dependency("        db.rollback()") };
    expect(await checkProject(files, "")).toEqual([]);
  });

  test("reports a rollback without raise, in a file that doesn't mention FastAPI", async () => {
    expect(await fapi007(dependency("        db.rollback()"))).toEqual([SWALLOWS]);
  });

  test("passes a clause that re-raises or raises an HTTPException", async () => {
    expect(await fapi007(dependency("        db.rollback()\n        raise"))).toEqual([]);
    expect(
      await fapi007(
        dependency('        log.exception("failed")\n        raise HTTPException(500) from None'),
      ),
    ).toEqual([]);
  });

  test.each([
    ["an if without else", "        if retry:\n            raise", 1],
    [
      "an if whose branches all raise",
      "        if retry:\n            raise\n        else:\n            raise Other()",
      0,
    ],
    [
      "an elif that doesn't raise",
      "        if a:\n            raise\n        elif b:\n            pass\n        else:\n            raise",
      1,
    ],
    ["a return before the raise", "        return\n        raise", 1],
    ["a with whose body raises", "        with lock:\n            raise", 0],
    [
      "a finally that raises",
      "        try:\n            db.rollback()\n        finally:\n            raise",
      0,
    ],
    [
      "a try whose handler swallows",
      "        try:\n            raise\n        except OSError:\n            pass",
      1,
    ],
    ["a loop with a raise", "        for x in xs:\n            raise", 0],
  ])("follows paths: %s", async (_what, handler, count) => {
    expect(await fapi007(dependency(handler))).toHaveLength(count);
  });

  test("reports each swallowing clause, and skips GeneratorExit", async () => {
    const text = `async def get_session():
    try:
        yield session
    except GeneratorExit:
        pass
    except (IntegrityError, OSError) as error:
        await session.rollback()
    except:
        pass
`;
    expect(await fapi007(text)).toEqual([
      "app/db.py:6 `except (IntegrityError, OSError) as error:` in `get_session` can end without raising, so it swallows what the endpoint raised at the `yield`: the client gets a 500, even for an HTTPException, and the server logs nothing.",
      "app/db.py:8 `except:` in `get_session` can end without raising, so it swallows what the endpoint raised at the `yield`: the client gets a 500, even for an HTTPException, and the server logs nothing.",
    ]);
  });

  test("leaves out streaming generators, several yields, decorated functions and code after the yield", async () => {
    const text = `from contextlib import contextmanager


def stream():
    try:
        for chunk in chunks:
            yield chunk
    except Exception:
        pass


def twice():
    try:
        yield 1
        yield 2
    except Exception:
        pass


@contextmanager
def suppressed():
    try:
        yield
    except Exception:
        pass


def after():
    yield db
    try:
        db.commit()
    except Exception:
        pass


def nested():
    def inner():
        yield
    try:
        return inner
    except Exception:
        pass
`;
    expect(await fapi007(text)).toEqual([]);
  });

  test("is suppressed on the except line", async () => {
    const text = dependency("        db.rollback()").replace(
      "except Exception:",
      'except Exception:  # inwards: ignore[FAPI007] reason="errors are reported by the gateway"',
    );
    expect(await fapi007(text)).toEqual([]);
  });
});
