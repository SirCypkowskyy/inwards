/**
 * @file The context presets of `inwards init --style` (#93) keep their
 * packages apart: after the scaffold passes, a second slice, context or app
 * is added the way a user would (its package and its contexts entry), and a
 * planted import across the boundary fails with INW002 or INW003, one against
 * a role's order with INW001, while an import through the public module
 * passes. Hexagonal's adapters are sibling layers, so one importing the other
 * fails with INW001. The fastapi preset is also checked in the
 * fastapi-best-practices layout, with its FastAPI rules on.
 */
import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { init, UV_PROJECT } from "../support/init-style-helpers.ts";
import { inwards, project } from "../support/run.ts";

/**
 * Runs `inwards check --format json` and lists each finding.
 *
 * @param root - the project directory.
 * @returns the exit code and each finding as `CODE file`, sorted.
 */
function findings(root: string): { code: number; findings: string[] } {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  const { diagnostics } = JSON.parse(stdout);
  const out: string[] = [];
  for (const d of diagnostics) {
    out.push(`${d.code} ${d.file}`);
  }
  return { code, findings: out.sort() };
}

/**
 * Writes files into a project, creating their directories.
 *
 * @param root - the project directory.
 * @param files - file text keyed by path relative to the project.
 */
function write(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
}

/**
 * Adds a context entry to the project's config, as a user adds one for a new package.
 *
 * @param root - the project directory.
 * @param entry - the entry's keys, e.g. `name = "billing"`, one per line.
 */
function addContext(root: string, ...entry: string[]): void {
  appendFileSync(
    join(root, "pyproject.toml"),
    `\n[[tool.inwards.contexts]]\n${entry.join("\n")}\n`,
  );
}

/**
 * Lets a context depend on orders, as a user does once the dependency is decided.
 *
 * @param root - the project directory.
 * @param name - the context that gets `depends-on = ["orders"]`.
 */
function dependOnOrders(root: string, name: string): void {
  const path = join(root, "pyproject.toml");
  const entry = `name = "${name}"\n`;
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(entry, `${entry}depends-on = ["orders"]\n`),
  );
}

/**
 * Scaffolds a preset on a fresh uv project.
 *
 * @param style - the preset.
 * @returns the project directory, and the exit code of init and the findings of a check right after.
 */
function scaffolded(style: string): {
  root: string;
  result: { init: number; check: ReturnType<typeof findings> };
} {
  const root = project(UV_PROJECT);
  const { code } = init(root, "--style", style, "--scaffold");
  return { root, result: { init: code, check: findings(root) } };
}

/** What a fresh scaffold gives: init exits 0 and the check finds nothing. */
const PASSING = { init: 0, check: { code: 0, findings: [] } };

describe("vertical-slices", () => {
  const billing = "src/my_app/features/billing";

  test("a slice importing another slice fails with INW002; with depends-on, only its api passes", () => {
    const { root, result } = scaffolded("vertical-slices");
    expect(result).toEqual(PASSING);
    write(root, {
      [`${billing}/__init__.py`]: "",
      [`${billing}/api.py`]: "from my_app.features.orders.order import Order\n",
    });
    addContext(
      root,
      'name = "billing"',
      'modules = ["my_app.features.billing"]',
      'template = "slice"',
    );
    expect(findings(root)).toEqual({ code: 1, findings: [`INW002 ${billing}/api.py`] });
    dependOnOrders(root, "billing");
    expect(findings(root)).toEqual({ code: 1, findings: [`INW003 ${billing}/api.py`] });
    write(root, { [`${billing}/api.py`]: "from my_app.features.orders.api import PlaceOrder\n" });
    expect(findings(root)).toEqual({ code: 0, findings: [] });
  });

  test("the composition root importing a slice's internals fails with INW003", () => {
    const { root, result } = scaffolded("vertical-slices");
    expect(result).toEqual(PASSING);
    write(root, {
      "src/my_app/bootstrap.py": "from my_app.features.orders.place_order import PlaceOrder\n",
    });
    expect(findings(root)).toEqual({ code: 1, findings: ["INW003 src/my_app/bootstrap.py"] });
  });
});

describe("bounded-contexts", () => {
  const billing = "src/my_app/billing";
  const billingPackage = {
    [`${billing}/__init__.py`]: "",
    [`${billing}/domain/__init__.py`]: "",
    [`${billing}/application/__init__.py`]: "",
    [`${billing}/infrastructure/__init__.py`]: "",
    [`${billing}/api.py`]: "",
  };
  const billingContext = [
    'name = "billing"',
    'modules = ["my_app.billing"]',
    'template = "context"',
  ];

  test("a context importing another fails with INW002; with depends-on, its internals fail with INW003 and its api passes", () => {
    const { root, result } = scaffolded("bounded-contexts");
    expect(result).toEqual(PASSING);
    write(root, {
      ...billingPackage,
      [`${billing}/application/invoice.py`]: "from my_app.orders.domain.order import Order\n",
    });
    addContext(root, ...billingContext);
    expect(findings(root)).toEqual({
      code: 1,
      findings: [`INW002 ${billing}/application/invoice.py`],
    });
    dependOnOrders(root, "billing");
    expect(findings(root)).toEqual({
      code: 1,
      findings: [`INW003 ${billing}/application/invoice.py`],
    });
    write(root, {
      // The api is the outermost role, so a context reaches another from its own api.
      [`${billing}/api.py`]: "from my_app.orders.api import PlaceOrder\n",
      [`${billing}/application/invoice.py`]: "",
    });
    expect(findings(root)).toEqual({ code: 0, findings: [] });
  });

  test("a context's domain importing its application fails with INW001", () => {
    const { root, result } = scaffolded("bounded-contexts");
    expect(result).toEqual(PASSING);
    write(root, {
      "src/my_app/orders/domain/rules.py":
        "from my_app.orders.application.ports import OrderRepository\n",
    });
    expect(findings(root)).toEqual({
      code: 1,
      findings: ["INW001 src/my_app/orders/domain/rules.py"],
    });
  });
});

describe("django", () => {
  const billing = "src/my_app/billing";
  const billingApp = {
    [`${billing}/__init__.py`]: "",
    [`${billing}/models.py`]: "",
    [`${billing}/views.py`]: "",
    [`${billing}/urls.py`]: "",
  };

  test("an app importing another app's models fails with INW003; its services pass", () => {
    const { root, result } = scaffolded("django");
    expect(result).toEqual(PASSING);
    addContext(root, 'name = "billing"', 'modules = ["my_app.billing"]', 'template = "django-app"');
    write(root, {
      ...billingApp,
      [`${billing}/services.py`]: "from my_app.orders.models import Order\n",
    });
    expect(findings(root)).toEqual({ code: 1, findings: [`INW003 ${billing}/services.py`] });
    write(root, { [`${billing}/services.py`]: "from my_app.orders.services import place_order\n" });
    expect(findings(root)).toEqual({ code: 0, findings: [] });
  });

  test("models importing the views fails with INW001", () => {
    const { root, result } = scaffolded("django");
    expect(result).toEqual(PASSING);
    write(root, { "src/my_app/orders/models.py": "from my_app.orders.views import place\n" });
    expect(findings(root)).toEqual({ code: 1, findings: ["INW001 src/my_app/orders/models.py"] });
  });
});

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

  test("the scaffold passes with the FAPI rules on, and init prints the Ruff config without writing it", () => {
    const { root, run, check } = bestPractices();
    expect({ init: run.code, check }).toEqual(PASSING);
    const text = readFileSync(join(root, "pyproject.toml"), "utf8");
    expect(text).toContain('extend-select = ["FAPI001", "FAPI002", "FAPI003"]');
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

test("hexagonal: an inbound adapter importing an outbound one fails with INW001", () => {
  const { root, result } = scaffolded("hexagonal");
  expect(result).toEqual(PASSING);
  write(root, {
    "src/my_app/adapters/inbound/web.py":
      "from my_app.adapters.outbound.in_memory_orders import InMemoryOrderRepository\n",
  });
  expect(findings(root)).toEqual({
    code: 1,
    findings: ["INW001 src/my_app/adapters/inbound/web.py"],
  });
});
