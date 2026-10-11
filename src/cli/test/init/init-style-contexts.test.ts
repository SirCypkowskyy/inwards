/**
 * @file The context presets of `inwards init --style` (#93) keep their
 * packages apart: after the scaffold passes, a second slice, context or app
 * is added the way a user would (its package and its contexts entry), and a
 * planted import across the boundary fails with INW002 or INW003, one against
 * a role's order with INW001, while an import through the public module
 * passes. Hexagonal's adapters are sibling layers, so one importing the other
 * fails with INW001. The fastapi preset's own layout is
 * `init-style-fastapi.test.ts`'s.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addContext,
  findings,
  init,
  PASSING,
  UV_PROJECT,
  write,
} from "../support/init-style-helpers.ts";
import { project } from "../support/run.ts";

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

  test("models importing the views fails with INW001, and closes a module cycle (INW004)", () => {
    const { root, result } = scaffolded("django");
    expect(result).toEqual(PASSING);
    write(root, { "src/my_app/orders/models.py": "from my_app.orders.views import place\n" });
    // The views already reach the models through the services.
    expect(findings(root)).toEqual({
      code: 1,
      findings: ["INW001 src/my_app/orders/models.py", "INW004 src/my_app/orders/models.py"],
    });
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
