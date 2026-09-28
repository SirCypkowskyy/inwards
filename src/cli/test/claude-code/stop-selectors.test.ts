/**
 * @file The Stop gate under layer selectors (#191, ADR-034). Every scenario runs
 * twice, once with selectors and once with the literal config that lists the
 * same slices, and both must give the same exit code: a slice moved away
 * while another keeps the selector alive, moves that keep an `__init__.py`,
 * moves into ignored or skipped directories, and the routine edits under
 * `shop.**` that must not block (R1 to R4 of the issue's review).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { git, put, session, stop } from "../support/stop-helpers.ts";

/**
 * Writes a config with two layers.
 *
 * @param domain - the domain layer's entries.
 * @param infra - the infrastructure layer's entries.
 * @returns the pyproject.toml text, with `tests` ignored.
 */
function layers(domain: string[], infra: string[]): string {
  return `[tool.inwards]
ignore = ["tests"]
layers = [
  { name = "domain", modules = ${JSON.stringify(domain)} },
  { name = "infrastructure", modules = ${JSON.stringify(infra)} },
]
`;
}

/** Two slices, orders and billing, each with a domain and an infra package. */
const FILES: Record<string, string> = {
  "shop/__init__.py": "",
  "shop/orders/__init__.py": "",
  "shop/orders/helpers.py": "H = 1\n",
  "shop/orders/domain/__init__.py": "",
  "shop/orders/domain/order.py": "ORDER = 1\n",
  "shop/orders/infra/__init__.py": "",
  "shop/orders/infra/db.py": "DB = 1\n",
  "shop/orders/infra/old.py": "OLD = 1\n",
  "shop/billing/__init__.py": "",
  "shop/billing/domain/__init__.py": "",
  "shop/billing/domain/invoice.py": "INVOICE = 1\n",
  "shop/billing/infra/__init__.py": "",
  "shop/billing/infra/db.py": "BILLING_DB = 1\n",
};

/** The same layers as selectors and as literal lists of slices. */
const CONFIGS: Record<string, { selectors: string; literals: string }> = {
  slices: {
    selectors: layers(["shop.*.domain"], ["shop.*.infra"]),
    literals: layers(
      ["shop.orders.domain", "shop.billing.domain"],
      ["shop.orders.infra", "shop.billing.infra"],
    ),
  },
  broad: {
    selectors: layers(["shop.*.domain"], ["shop.**"]),
    literals: layers(["shop.orders.domain", "shop.billing.domain"], ["shop"]),
  },
  leaves: {
    selectors: layers(["shop.*.domain"], ["shop.*.infra.*"]),
    literals: layers(
      ["shop.orders.domain", "shop.billing.domain"],
      ["shop.orders.infra", "shop.billing.infra"],
    ),
  },
};

/**
 * Moves a directory or file, creating the destination's parent.
 *
 * @param root - the project directory.
 * @param from - the path to move, relative to the project.
 * @param to - where it goes.
 */
function move(root: string, from: string, to: string): void {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  renameSync(join(root, from), join(root, to));
}

/** One scenario: which config, what the agent does, and the exit code both configs must give. */
type Scenario = [string, keyof typeof CONFIGS, (root: string) => void, number];

const SCENARIOS: Scenario[] = [
  [
    "a slice moved away while another keeps the selector alive",
    "slices",
    (root: string): void => git(root, "mv", "shop/billing/domain", "shop/billing/core"),
    2,
  ],
  [
    "a slice's module moved out, its __init__.py kept",
    "slices",
    (root: string): void =>
      move(root, "shop/billing/domain/invoice.py", "shop/billing/core/invoice.py"),
    2,
  ],
  [
    "a slice moved into an ignored directory",
    "slices",
    (root: string): void => move(root, "shop/billing/domain", "shop/billing/tests/domain"),
    2,
  ],
  [
    "a slice moved into the root's node_modules",
    "slices",
    (root: string): void => move(root, "shop/billing/domain", "node_modules/billing/domain"),
    2,
  ],
  [
    "a slice moved into a virtualenv",
    "slices",
    (root: string): void => {
      put(root, "venv/pyvenv.cfg", "");
      move(root, "shop/billing/domain", "venv/billing/domain");
    },
    2,
  ],
  [
    "a slice moved into a node_modules directory next to it",
    "slices",
    (root: string): void => move(root, "shop/billing/domain", "shop/billing/node_modules/domain"),
    2,
  ],
  [
    "a slice renamed",
    "slices",
    (root: string): void => git(root, "mv", "shop/billing", "shop/sales"),
    2,
  ],
  [
    "a slice deleted outright",
    "slices",
    (root: string): void => rmSync(join(root, "shop/billing/domain"), { recursive: true }),
    2,
  ],
  [
    "a slice's module deleted, another left",
    "slices",
    (root: string): void => rmSync(join(root, "shop/orders/infra/old.py")),
    0,
  ],
  [
    "R1: an infra module deleted under shop.**",
    "broad",
    (root: string): void => rmSync(join(root, "shop/orders/infra/old.py")),
    0,
  ],
  [
    "R2: a helper deleted under shop.**",
    "broad",
    (root: string): void => rmSync(join(root, "shop/orders/helpers.py")),
    0,
  ],
  [
    "R3: an infra module renamed under shop.**",
    "broad",
    (root: string): void =>
      git(root, "mv", "shop/orders/infra/old.py", "shop/orders/infra/legacy.py"),
    0,
  ],
  [
    "R4: a module deleted under shop.*.infra.*",
    "leaves",
    (root: string): void => rmSync(join(root, "shop/orders/infra/old.py")),
    0,
  ],
];

describe("Stop gate: selectors and literal configs agree", () => {
  test.each(
    SCENARIOS.flatMap(([name, config, act, want]) =>
      (["selectors", "literals"] as const).map(
        (kind) => [name, kind, { text: CONFIGS[config]?.[kind] ?? "", act, want }] as const,
      ),
    ),
  )("%s (%s)", (_, __, { text, act, want }) => {
    const root = session({ ...FILES, "pyproject.toml": text });
    act(root);
    const { code, stderr } = stop(root);
    expect({ code, stderr: code === want ? "" : stderr }).toEqual({ code: want, stderr: "" });
  });
});
