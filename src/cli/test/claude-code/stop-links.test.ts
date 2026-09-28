/**
 * @file The Stop gate on symlinks inside layers (#83, #84). The session start
 * records the links in layer packages, so a link made during the session out
 * of the project or into another layer blocks, while one that was already
 * there at the start doesn't, as an old violation in an untouched file
 * doesn't. Symlinks need privileges on Windows, so these skip there.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { inwards, SLICES } from "../support/run.ts";
import { agentWrites, ID, put, session, stop } from "../support/stop-helpers.ts";
import { tempDir } from "../support/temp.ts";

const WINDOWS = process.platform === "win32";

/**
 * Makes a directory outside every project with a module that imports infrastructure.
 *
 * @returns the directory.
 */
function outsideLeak(): string {
  const outside = tempDir("inwards-outside-");
  writeFileSync(join(outside, "leak.py"), "import shop.infrastructure.db\n");
  return outside;
}

describe.skipIf(WINDOWS)("Stop gate: symlinks in layers", () => {
  test("a link out of the project made during the session blocks (#83)", () => {
    const root = session();
    symlinkSync(outsideLeak(), join(root, "shop/domain/ext"), "dir");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain('"file":"shop/domain/ext"');
    expect(stderr).toContain("symlink out of root");
  });

  test("a link into another layer made during the session blocks (#84)", () => {
    const root = session({ "shop/infrastructure/db.py": "X = 1\n" });
    symlinkSync("../infrastructure", join(root, "shop/domain/infra_alias"), "dir");
    agentWrites(root, "shop/domain/order.py", "from shop.domain.infra_alias import db\n");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain('"file":"shop/domain/infra_alias"');
    expect(stderr).toContain('in layer \\"infrastructure\\"');
  });

  test("a link retargeted into another layer during the session blocks", () => {
    const root = session(
      { "shop/infrastructure/db.py": "X = 1\n", "shop/domain/real/x.py": "" },
      (r) => symlinkSync("real", join(r, "shop/domain/alias"), "dir"),
    );
    rmSync(join(root, "shop/domain/alias"));
    symlinkSync("../infrastructure", join(root, "shop/domain/alias"), "dir");
    expect(stop(root).code).toBe(2);
  });

  test("a link within its layer made during the session passes", () => {
    const root = session({ "shop/domain/real/x.py": "X = 1\n" });
    symlinkSync("real", join(root, "shop/domain/alias"), "dir");
    expect(stop(root).code).toBe(0);
  });

  test("a link there at session start doesn't block, but `inwards check` still reports it", () => {
    const outside = outsideLeak();
    const root = session({}, (r) => symlinkSync(outside, join(r, "shop/domain/ext"), "dir"));
    agentWrites(root, "shop/domain/order.py", "X = 2\n");
    expect(stop(root).code).toBe(0);
    expect(inwards(["check"], { cwd: root }).code).toBe(1);
  });

  test("a start record without links (an older state file) fails closed", () => {
    const outside = outsideLeak();
    const root = session({}, (r) => symlinkSync(outside, join(r, "shop/domain/ext"), "dir"));
    const path = join(root, `.inwards/state/${ID}.start.json`);
    const { links: _, ...older } = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify(older));
    put(root, "shop/domain/order.py", "X = 2\n");
    expect(stop(root).code).toBe(2);
  });

  test("a chain through code outside every layer made during the session blocks (review P2-1)", () => {
    const root = session({ "shop/misc/__init__.py": "", "shop/infrastructure/db.py": "X = 1\n" });
    symlinkSync("../misc", join(root, "shop/domain/a"), "dir");
    symlinkSync("../infrastructure", join(root, "shop/misc/y"), "dir");
    agentWrites(root, "shop/domain/order.py", "from shop.domain.a.y import db\n");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain('"file":"shop/domain/a/y"');
  });

  test("a link in a layer package that is itself a link blocks (review P2-2)", () => {
    const root = session(
      {
        "packages/shop/domain/order.py": "X = 1\n",
        "packages/shop/infrastructure/db.py": "X = 1\n",
      },
      (r) => {
        rmSync(join(r, "shop"), { recursive: true });
        symlinkSync("packages/shop", join(r, "shop"), "dir");
      },
    );
    symlinkSync("../infrastructure", join(root, "packages/shop/domain/alias"), "dir");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain('"file":"shop/domain/alias"');
  });

  test("a new slice linked out of the root blocks (review P2-3)", () => {
    const outside = tempDir("inwards-outside-");
    mkdirSync(join(outside, "domain"));
    writeFileSync(join(outside, "domain/svc.py"), "import shop.orders.infrastructure.db\n");
    const root = session({
      "pyproject.toml": SLICES,
      "shop/orders/domain/order.py": "X = 1\n",
      "shop/orders/infrastructure/db.py": "X = 1\n",
    });
    symlinkSync(outside, join(root, "shop/payments"), "dir");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain('"file":"shop/payments"');
  });

  test("a link out of the root moved to another outside directory blocks (review P3)", () => {
    const first = outsideLeak();
    const root = session({}, (r) => symlinkSync(first, join(r, "shop/domain/ext"), "dir"));
    rmSync(join(root, "shop/domain/ext"));
    symlinkSync(outsideLeak(), join(root, "shop/domain/ext"), "dir");
    expect(stop(root).code).toBe(2);
  });
});
