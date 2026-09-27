/**
 * @file OpenCode end to end: `inwards init --agent opencode` in a fresh
 * project, then `opencode run` with a prompt that asks for an outward import.
 * The plugin hands the INW001 finding back in the tool result, and the agent
 * has to fix it: the project checks clean afterwards. It calls a real model,
 * so it runs only with `opencode` on PATH and `INWARDS_OPENCODE_MODEL` set
 * (`provider/model`, as `opencode run -m` takes it); otherwise it is skipped.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { inwards, LAYERS, project } from "../support/run.ts";

const MODEL: string | undefined = process.env["INWARDS_OPENCODE_MODEL"];
const OPENCODE: string | null = Bun.which("opencode");
/** A model call per step, several steps: minutes, not seconds. */
const TIMEOUT_MS = 600_000;

describe.skipIf(MODEL === undefined || OPENCODE === null)("OpenCode with a real model", () => {
  test(
    "an outward import reaches the agent as INW001, and the agent fixes it",
    () => {
      const root = project({
        "pyproject.toml": LAYERS,
        "shop/__init__.py": "",
        "shop/domain/__init__.py": "",
        "shop/domain/order.py": "class Order:\n    pass\n",
        "shop/infrastructure/__init__.py": "",
        "shop/infrastructure/db.py": "def save(order) -> None:\n    pass\n",
      });
      Bun.spawnSync(["git", "init", "-q"], { cwd: root });
      expect(inwards(["init", "--agent", "opencode"], { cwd: root }).code).toBe(0);
      const prompt =
        "In shop/domain/order.py, add a method persist(self) to Order that calls save(self) from shop.infrastructure.db. Import it at the top of the file. Keep it short.";
      const run = Bun.spawnSync([OPENCODE ?? "opencode", "run", "-m", MODEL ?? "", prompt], {
        cwd: root,
        stdin: "ignore",
        timeout: TIMEOUT_MS,
      });
      const transcript = run.stdout.toString();
      expect(transcript).toContain("INW001");
      const check = inwards(["check"], { cwd: root });
      expect([check.code, check.stdout]).toEqual([0, expect.any(String)]);
      expect(readFileSync(join(root, "shop/domain/order.py"), "utf8")).not.toContain(
        "shop.infrastructure",
      );
    },
    TIMEOUT_MS,
  );
});
