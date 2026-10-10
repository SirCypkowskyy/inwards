/**
 * @file The fastapi preset of `inwards init --style`, checked in the
 * fastapi-best-practices layout (`--package src`): the scaffold passes with
 * the FastAPI rules, INW012 and INW013 on, and a planted fat endpoint,
 * blocking session call, undeclared error or import across a domain's
 * boundary gets its finding. Split from `init-style-contexts.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addContext, findings, init, PASSING, write } from "../support/init-style-helpers.ts";
import { inwards, project } from "../support/run.ts";

/**
 * Writes the scaffold's router back with an `async def` endpoint that reads a
 * post through a session parameter, and the imports it needs.
 *
 * @param router - the router's path.
 * @param scaffold - the router as the scaffold wrote it.
 * @param session - the class the `db` parameter is annotated with, `Session` or `AsyncSession`.
 * @param call - the session call the endpoint returns on, with or without `await`.
 */
function withSession(router: string, scaffold: string, session: string, call: string): void {
  const imports = [
    "from sqlalchemy.ext.asyncio import AsyncSession",
    "from sqlalchemy.orm import Session",
    "",
    "from src.posts.models import Post",
    "from src.posts.dependencies",
  ].join("\n");
  writeFileSync(
    router,
    [
      scaffold.replace("from src.posts.dependencies", imports),
      "",
      '@router.get("/{post_id}/exists", summary="Check a post exists")',
      `async def post_exists(post_id: int, db: Annotated[${session}, Depends()]) -> bool:`,
      `    return ${call} is not None`,
      "",
    ].join("\n"),
  );
}

describe("fastapi, in the fastapi-best-practices layout (--package src)", () => {
  /**
   * Scaffolds the fastapi preset with `src` as the import package, as fastapi-best-practices has it.
   *
   * @returns the project directory, the init run and the findings of a check right after.
   */
  function bestPractices(): {
    root: string;
    run: ReturnType<typeof init>;
    check: ReturnType<typeof findings>;
  } {
    const root = project({ "pyproject.toml": '[project]\nname = "blog"\nversion = "0.1.0"\n' });
    const run = init(root, "--style", "fastapi", "--scaffold", "--package", "src");
    return { root, run, check: findings(root) };
  }

  test("the scaffold passes with the FAPI rules, INW012 and INW013 on, and init prints the Ruff config without writing it", () => {
    const { root, run, check } = bestPractices();
    expect({ init: run.code, check }).toEqual(PASSING);
    const text = readFileSync(join(root, "pyproject.toml"), "utf8");
    expect(text).toContain(
      'extend-select = ["FAPI001", "FAPI002", "FAPI003", "FAPI005", "FAPI006", "FAPI007", "FAPI008", "FAPI009", "INW012", "INW013"]',
    );
    expect(text).toContain('INW012 = "warning"');
    expect(text).toContain('INW013 = "warning"');
    expect(text).toContain('[tool.inwards.rules.thin-endpoint]\ndelegate-to = ["domain.service"]');
    expect(text).toContain("report-direct-raises = false");
    expect(text).not.toContain("tool.ruff");
    expect(run.stdout).toContain('extend-select = ["ASYNC", "FAST", "TID251"]');
    expect(run.stdout).toContain('"src/models.py" = ["TID251"]');
  });

  test("an undeclared error response is a FAPI002 warning", () => {
    const { root } = bestPractices();
    const router = join(root, "src/posts/router.py");
    const text = readFileSync(router, "utf8");
    const declared =
      '    responses={status.HTTP_404_NOT_FOUND: {"description": "No post has this id"}},\n';
    expect(text).toContain(declared);
    writeFileSync(router, text.replace(declared, ""));
    expect(findings(root)).toEqual({ code: 0, findings: ["FAPI002 src/posts/router.py"] });
  });

  test("a fat endpoint in the router is an INW012 warning that names its domain's service module", () => {
    const { root } = bestPractices();
    appendFileSync(
      join(root, "src/posts/router.py"),
      [
        "",
        "",
        '@router.get("/{post_id}/words", summary="Count the words of a post")',
        "async def count_words(post_id: int) -> dict[str, int]:",
        "    counts: dict[str, int] = {}",
        "    for word in str(post_id).split():",
        "        counts[word] = counts.get(word, 0) + 1",
        "    return counts",
        "",
      ].join("\n"),
    );
    const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
    const [finding, ...rest] = JSON.parse(stdout).diagnostics;
    expect({ code, rest }).toEqual({ code: 0, rest: [] });
    expect(finding).toMatchObject({
      code: "INW012",
      file: "src/posts/router.py",
      severity: "warning",
    });
    expect(finding.fix.summary).toBe(
      "Move the work out of `count_words` into the `domain.service` layer (`src.posts.service`), and keep the endpoint to HTTP.",
    );
  });

  test("an async def endpoint on a sync Session is an INW013 warning; an AsyncSession passes", () => {
    const { root } = bestPractices();
    const router = join(root, "src/posts/router.py");
    const scaffold = readFileSync(router, "utf8");
    withSession(router, scaffold, "Session", "db.get(Post, post_id)");
    const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
    const diagnostics: { code: string; severity: string }[] = JSON.parse(stdout).diagnostics;
    // The query in the endpoint is also INW012's: the endpoint does the work itself.
    expect({ code, found: diagnostics.map((d) => `${d.code} ${d.severity}`).sort() }).toEqual({
      code: 0,
      found: ["INW012 warning", "INW013 warning"],
    });
    withSession(router, scaffold, "AsyncSession", "(await db.get(Post, post_id))");
    expect(findings(root)).toEqual({ code: 0, findings: ["INW012 src/posts/router.py"] });
  });

  test("a deprecated startup event in main.py is a FAPI006 warning", () => {
    const { root } = bestPractices();
    appendFileSync(
      join(root, "src/main.py"),
      '\n\n@app.on_event("startup")\nasync def warm_up() -> None:\n    """Runs once at startup."""\n',
    );
    expect(findings(root)).toEqual({ code: 0, findings: ["FAPI006 src/main.py"] });
  });

  test("a helpers module in a domain fails with INW007, the service importing the router with INW001", () => {
    const { root } = bestPractices();
    write(root, { "src/posts/helpers.py": "VALUE = 1\n" });
    expect(findings(root)).toEqual({ code: 1, findings: ["INW007 src/posts/helpers.py"] });
    const service = join(root, "src/posts/service.py");
    writeFileSync(service, `from src.posts.router import router\n${readFileSync(service, "utf8")}`);
    expect(findings(root).findings).toContain("INW001 src/posts/service.py");
  });

  test("a domain importing another domain's models fails with INW003; its service passes", () => {
    const { root } = bestPractices();
    addContext(root, 'name = "auth"', 'modules = ["src.auth"]', 'template = "fastapi-domain"');
    write(root, {
      "src/auth/__init__.py": "",
      "src/auth/router.py": "",
      "src/auth/service.py": "from src.posts.models import Post\n",
    });
    expect(findings(root)).toEqual({ code: 1, findings: ["INW003 src/auth/service.py"] });
    write(root, { "src/auth/service.py": "from src.posts.service import get_post\n" });
    expect(findings(root)).toEqual({ code: 0, findings: [] });
  });
});
