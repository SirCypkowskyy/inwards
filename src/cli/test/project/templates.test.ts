/**
 * @file The acceptance tests of package templates (#97): a
 * fastapi-best-practices project described by one template passes, the
 * imports the issue names fail or pass with the expected rule, and the
 * template config gives exactly the diagnostics of its hand-written
 * equivalent (`hand-written.toml` in the fixture), pinned by a snapshot.
 * Each case copies the fixture to a temp project and plants its imports there.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Diagnostic, parseConfig } from "@inwards/core";
import { inwards, project } from "../support/run.ts";

const FIXTURE = join(import.meta.dir, "../support/fixtures/templates/fastapi");
const HAND = "hand-written.toml";

/**
 * Reads the fixture's files.
 *
 * @returns their text, by fixture-relative path.
 */
function fixture(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const rel of readdirSync(FIXTURE, { recursive: true, encoding: "utf8" })) {
    if (rel.endsWith(".py") || rel.endsWith(".toml")) {
      files[rel.replaceAll("\\", "/")] = readFileSync(join(FIXTURE, rel), "utf8");
    }
  }
  return files;
}

/**
 * Copies the fixture to a temp project, with lines added to some of its files.
 *
 * @param extra - Python lines to append, by file.
 * @returns the project root.
 */
function planted(extra: Record<string, string> = {}): string {
  const files = fixture();
  for (const [rel, line] of Object.entries(extra)) {
    files[rel] = `${files[rel] ?? ""}${line}\n`;
  }
  return project(files);
}

/**
 * Runs `inwards check --format json` in a project.
 *
 * @param root - the project root.
 * @param config - a config file other than pyproject.toml, if any.
 * @returns the exit code and the diagnostics.
 */
function check(root: string, config?: string): { code: number; diagnostics: Diagnostic[] } {
  const flags = config === undefined ? [] : ["--config", config];
  const { code, stdout } = inwards(["check", "--format", "json", ...flags], { cwd: root });
  return { code, diagnostics: JSON.parse(stdout).diagnostics };
}

/**
 * Lists a report's findings as `code path message`, the short form the assertions compare.
 *
 * @param diagnostics - a check's findings.
 * @returns one line per finding.
 */
function lines(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => `${d.code} ${d.file}: ${d.message}`);
}

const VIOLATIONS = {
  "src/orders/service.py": "from src.orders import router\nfrom src.users.models import User",
  "src/orders/schemas.py": "from src.orders.models import Order",
};

describe("fastapi-best-practices with one template", () => {
  test("passes inwards check with 0 findings, orders.router -> users.service included", () => {
    expect(fixture()["src/orders/router.py"]).toContain("from src.users import service");
    expect(check(planted())).toEqual({ code: 0, diagnostics: [] });
  });

  test("service -> router and schemas -> models fail with INW001, orders -> users.models with INW003", () => {
    const { code, diagnostics } = check(planted(VIOLATIONS));
    expect(code).toBe(1);
    expect(lines(diagnostics)).toEqual([
      'INW001 src/orders/schemas.py: Layer "domain.schemas" imports "src.orders.models.Order" from sibling layer "domain.models". Allowed direction: core <- domain.constants | domain.config <- domain.exceptions | domain.utils <- domain.models | domain.schemas <- domain.service <- domain.dependencies <- domain.router <- app.',
      'INW001 src/orders/service.py: Layer "domain.service" imports "src.orders.router" from outer layer "domain.router". Allowed direction: core <- domain.constants | domain.config <- domain.exceptions | domain.utils <- domain.models | domain.schemas <- domain.service <- domain.dependencies <- domain.router <- app.',
      'INW003 src/orders/service.py: Context "orders" imports "src.users.models.User" from context "users", but "src.users.models" isn\'t one of its public modules.',
    ]);
  });

  test("a role no package has is reported at the entry that carries the template", () => {
    const files = Object.fromEntries(
      Object.entries(fixture()).filter(([rel]) => !rel.endsWith("/utils.py")),
    );
    const [dead, ...rest] = check(project(files)).diagnostics;
    expect(rest).toEqual([]);
    expect(dead).toMatchObject({
      code: "INW006",
      file: "pyproject.toml",
      line: 8,
      column: 33,
      message:
        '"src.*.utils" (layer "domain.utils") matches no module, so layer "domain.utils" is empty.',
    });
    expect(dead?.fix.summary).toBe(
      'Ask the user to fix or remove role "utils" of the template on "src.*" in [tool.inwards].',
    );
  });

  test("the template's hints reach the INW007 fix steps", () => {
    const root = planted({ "src/orders/helpers.py": "" });
    const shape = check(root).diagnostics.find((d) => d.code === "INW007");
    expect(shape?.fix.steps).toContain(
      "Other domains may import this one's router, service, dependencies, schemas, constants and exceptions, never its models, config or utils.",
    );
  });
});

test("the configuration guide shows the fixture's config as it is", () => {
  const guide = readFileSync(
    join(import.meta.dir, "../../../../docs/chapters/guides/configuration.md"),
    "utf8",
  );
  const toml = fixture()["pyproject.toml"] ?? "";
  expect(guide).toContain(toml.slice(toml.indexOf("[tool.inwards]")).trim());
});

describe("the template expands to the hand-written config", () => {
  test("both parse to the same config", () => {
    const files = fixture();
    expect(parseConfig(files["pyproject.toml"] ?? "")).toEqual(parseConfig(files[HAND] ?? ""));
  });

  test("both give the same diagnostics, clean and with violations", () => {
    const clean = planted();
    expect(check(clean, HAND)).toEqual(check(clean));
    const root = planted({ ...VIOLATIONS, "src/orders/helpers.py": "import src.users.utils" });
    const templated = check(root);
    expect(check(root, HAND)).toEqual(templated);
    expect(lines(templated.diagnostics)).toMatchSnapshot();
  });
});
