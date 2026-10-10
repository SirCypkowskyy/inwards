/**
 * @file Texts laid over the disk (`overlayTexts`), on the real filesystem
 * adapters: a given text replaces a file's, and a file that doesn't exist yet,
 * with the directories above it, shows up in the probe, the listings, the
 * real paths and the walk. The disk stays untouched: the tests check that no
 * directory was made.
 */
import { expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { nodePlatform } from "../../src/adapters/compose.ts";
import { overlayTexts } from "../../src/project/overlay.ts";
import { project } from "../support/run.ts";

test("a new file and its missing directories appear in the probe, listings, reads and walk", async () => {
  const root = realpathSync(project({ "shop/domain/order.py": "x = 1\n" }));
  const order = join(root, "shop/domain/order.py");
  const fresh = join(root, "shop/domain/pricing/rules.py");
  const io = overlayTexts(
    nodePlatform(),
    new Map([
      [order, "y = 2\n"],
      [fresh, "z = 3\n"],
    ]),
  );
  expect(io.probe.kind(fresh)).toBe("file");
  expect(io.probe.kind(join(root, "shop/domain/pricing"))).toBe("dir");
  expect(io.probe.realpath(fresh)).toBe(fresh);
  expect(io.probe.isLink(fresh)).toBe(false);
  expect(io.read.text(order)).toBe("y = 2\n");
  expect(await io.read.texts([fresh, order])).toEqual(["z = 3\n", "y = 2\n"]);
  expect(
    io.read
      .list(join(root, "shop/domain"))
      ?.map((e) => `${e.name} ${e.dir}`)
      .sort(),
  ).toEqual(["order.py false", "pricing true"]);
  expect(io.read.list(join(root, "shop/domain/pricing"))?.map((e) => e.name)).toEqual(["rules.py"]);
  expect(io.walk.pythonFiles([root])).toEqual([order, fresh]);
  expect(io.walk.pythonSources([fresh])).toEqual([{ path: fresh, real: fresh }]);
  expect(existsSync(join(root, "shop/domain/pricing"))).toBe(false);
});

test("without texts the I/O is returned as it is", () => {
  const io = nodePlatform();
  expect(overlayTexts(io, new Map())).toBe(io);
});
