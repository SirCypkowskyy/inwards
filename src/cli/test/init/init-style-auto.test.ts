/**
 * @file `inwards init --style auto` (#343): the name table maps each known
 * module name to its layer, the closest preset orders the layers, unmapped
 * modules are listed as comments, and the first check after `--write` has no
 * "matches no module" finding, on a tree shaped like
 * full-stack-fastapi-template's backend and on copies of both `examples/`.
 * Also: the proposal without `--write` exits 2 and writes nothing, and the refusals.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NAME_TABLE, propose } from "../../src/init/auto.ts";
import { findings, init, stable, tree } from "../support/init-style-helpers.ts";
import { inwards, project } from "../support/run.ts";
import { tempDir } from "../support/temp.ts";

/** The repository, for `examples/`. */
const REPO = resolve(import.meta.dir, "../../../..");

/** A pyproject.toml whose `[project].name` is `app`. */
const APP = '[project]\nname = "app"\nversion = "0.1.0"\n';

/**
 * full-stack-fastapi-template's backend (commit 7257e60), cut down to its
 * module tree and its first-party imports.
 */
const FASTAPI_TEMPLATE: Record<string, string> = {
  "pyproject.toml": APP,
  "app/__init__.py": "",
  "app/alembic/env.py": "from app.models import SQLModel\nfrom app.core.config import settings\n",
  "app/api/__init__.py": "",
  "app/api/deps.py":
    "from app.core import security\nfrom app.core.config import settings\nfrom app.core.db import engine\nfrom app.models import User\n",
  "app/api/main.py":
    "from app.api.routes import items, login\nfrom app.core.config import settings\n",
  "app/api/routes/__init__.py": "",
  "app/api/routes/items.py": "from app.api.deps import SessionDep\nfrom app.models import Item\n",
  "app/api/routes/login.py":
    "from app import crud\nfrom app.api.deps import SessionDep\nfrom app.utils import send_email\n",
  "app/core/__init__.py": "",
  "app/core/config.py": "",
  "app/core/db.py":
    "from app import crud\nfrom app.core.config import settings\nfrom app.models import User\n",
  "app/core/security.py": "from app.core.config import settings\n",
  "app/crud.py": "from app.core.security import get_password_hash\nfrom app.models import Item\n",
  "app/initial_data.py": "from app.core.db import engine\n",
  "app/main.py": "from app.api.main import api_router\nfrom app.core.config import settings\n",
  "app/models.py": "",
  "app/utils.py": "from app.core import security\n",
  "app/email-templates/build/new_account.html": "",
  "tests/__init__.py": "",
  "tests/test_main.py": "from app.main import app\n",
};

/**
 * Lists the INW006 findings about a layer prefix that matches no module.
 *
 * @param cwd - the project.
 * @returns their messages.
 */
function deadPrefixes(cwd: string): string[] {
  const run = inwards(["check", "--format", "json"], { cwd });
  const report: { diagnostics: { code: string; message: string }[] } = JSON.parse(run.stdout);
  return report.diagnostics
    .filter((d) => d.code === "INW006" && d.message.includes("matches no module"))
    .map((d) => d.message);
}

/**
 * Reads the `[tool.inwards]` table init appended.
 *
 * @param root - the project.
 * @returns the table's text, or "" when there is none.
 */
function table(root: string): string {
  const text = tree(root)["pyproject.toml"] ?? "";
  const at = text.indexOf("[tool.inwards]");
  return at === -1 ? "" : text.slice(at);
}

describe("the name table", () => {
  const rows = NAME_TABLE.flatMap((row) => row.names.map((name) => [name, row.role] as const));
  test.each(rows)("%s maps to the %s role and nothing is left over", (name) => {
    const proposal = propose([{ name, package: true }]);
    expect(proposal.layers).toHaveLength(1);
    expect(proposal.layers[0]?.modules).toEqual([name]);
    expect(proposal.unmapped).toEqual([]);
  });

  test("each role becomes its preset's layer, innermost first", () => {
    const layered = ["core", "models", "repositories", "services", "api", "main"];
    const clean = ["core", "domain", "use_cases", "infrastructure", "views", "main"];
    const hexagonal = ["kernel", "entities", "application", "adapters", "endpoints", "bootstrap"];
    /**
     * Maps package names and keeps the layer names.
     *
     * @param names - the packages.
     * @returns the layers, innermost first.
     */
    function layers(names: string[]): string[] {
      return propose(names.map((name) => ({ name, package: true }))).layers.map((l) => l.name);
    }
    expect(layers(layered)).toEqual([
      "kernel",
      "domain",
      "persistence",
      "services",
      "presentation",
      "bootstrap",
    ]);
    expect(layers(clean)).toEqual([
      "kernel",
      "domain",
      "application",
      "infrastructure",
      "presentation",
      "bootstrap",
    ]);
    expect(layers(hexagonal)).toEqual([
      "kernel",
      "domain",
      "application",
      "adapters",
      "presentation",
      "bootstrap",
    ]);
  });

  test("an unknown name is left over, and alembic goes to ignore", () => {
    const proposal = propose([
      { name: "billing", package: true },
      { name: "alembic", package: true },
      { name: "api", package: true },
    ]);
    expect(proposal.layers.map((l) => l.name)).toEqual(["presentation"]);
    expect(proposal.unmapped).toEqual([{ name: "billing", package: true }]);
    expect(proposal.tooling).toEqual(["alembic"]);
  });
});

describe("inwards init --style auto", () => {
  test("full-stack-fastapi-template's backend: the table, then a check with no dead prefix", () => {
    const root = project(FASTAPI_TEMPLATE);
    const run = init(root, "--style", "auto", "--write");
    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");
    expect({
      stdout: stable(run.stdout, root),
      table: stable(table(root), root),
    }).toMatchSnapshot();
    expect(deadPrefixes(root)).toEqual([]);
  });

  // clean-app's domain/ports.py imports domain/order.py back only under
  // TYPE_CHECKING, which INW004 doesn't count (#375), so it checks clean.
  test.each([
    ["clean-app", []],
    ["broken-app", ["INW001 shop/domain/order.py"]],
  ])(
    "examples/%s without its config: every layer prefix matches a module, cycles on",
    (name, found) => {
      const root = tempDir("inwards-auto-");
      cpSync(join(REPO, "examples", name, "shop"), join(root, "shop"), { recursive: true });
      writeFileSync(join(root, "pyproject.toml"), `[project]\nname = "${name}"\n`);
      const run = init(root, "--style", "auto", "--write");
      expect(run.code).toBe(0);
      expect(table(root)).toContain('{ name = "domain", modules = ["shop.domain"] },');
      expect(table(root)).toContain('\ncycles = ["modules", "contexts"]\n');
      expect(deadPrefixes(root)).toEqual([]);
      expect(findings(root).findings).toEqual(found);
    },
  );

  test("an unmapped package is listed as a comment and stays out of every layer", () => {
    const root = project({
      "pyproject.toml": APP,
      "app/__init__.py": "",
      "app/api/__init__.py": "from app.billing import charge\n",
      "app/billing/__init__.py": "",
      "app/models.py": "",
    });
    expect(init(root, "--style", "auto", "--write").code).toBe(0);
    const written = table(root);
    expect(written).toContain('#   "app.billing"  (package)\n');
    expect(written).not.toContain('modules = ["app.billing"]');
    expect(deadPrefixes(root)).toEqual([]);
  });

  test("without --write and without a terminal: prints the table, exits 2, writes nothing", () => {
    const root = project(FASTAPI_TEMPLATE);
    const before = tree(root);
    const run = init(root, "--style", "auto");
    expect(run.code).toBe(2);
    expect(run.stdout.startsWith("[tool.inwards]\n")).toBe(true);
    expect(run.stderr).toContain("kernel        app.core, app.utils\n");
    expect(run.stderr).toContain("run it again with --write");
    expect(tree(root)).toEqual(before);
  });

  test("--dry-run prints the change as a diff and writes nothing", () => {
    const root = project(FASTAPI_TEMPLATE);
    const before = tree(root);
    const run = init(root, "--style", "auto", "--dry-run");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('+  { name = "services", modules = ["app.crud"] },');
    expect(tree(root)).toEqual(before);
  });

  test("a src layout without [project].name: finds the only package", () => {
    const root = project({
      "pyproject.toml": '[project]\nversion = "0.1.0"\n',
      "src/shop/__init__.py": "",
      "src/shop/services/__init__.py": "",
      "src/shop/routers/__init__.py": "",
    });
    expect(init(root, "--style", "auto", "--write").code).toBe(0);
    const written = table(root);
    expect(written).toContain('root = "src"');
    expect(written).toContain('{ name = "presentation", modules = ["shop.routers"] },');
    expect(deadPrefixes(root)).toEqual([]);
  });

  test("several packages: asks for --package, which then picks one", () => {
    const files = {
      "pyproject.toml": '[project]\nversion = "0.1.0"\n',
      "one/__init__.py": "",
      "one/api.py": "",
      "two/__init__.py": "",
      "two/models.py": "",
    };
    const root = project(files);
    const run = init(root, "--style", "auto", "--write");
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("found several packages (one, two)");
    expect(init(root, "--style", "auto", "--write", "--package", "two").code).toBe(0);
    expect(table(root)).toContain('modules = ["two.models"]');
  });

  test.each([
    [["--scaffold"], "--scaffold doesn't go with --style auto"],
    [["--package", "nope"], "--package nope: there is no nope/"],
  ])("refuses %p", (args, message) => {
    const root = project(FASTAPI_TEMPLATE);
    const run = init(root, "--style", "auto", "--write", ...args);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(message);
  });

  test("refuses a project with [tool.inwards], and one with no name it knows", () => {
    const configured = project({
      ...FASTAPI_TEMPLATE,
      "pyproject.toml": `${APP}\n[tool.inwards]\nlayers = []\n`,
    });
    expect(init(configured, "--style", "auto", "--write").stderr).toContain(
      "already has [tool.inwards]",
    );
    const unknown = project({ "pyproject.toml": APP, "app/__init__.py": "", "app/billing.py": "" });
    const run = init(unknown, "--style", "auto", "--write");
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("has a name the --style auto table knows");
  });
});
