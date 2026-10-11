/**
 * @file Every `inwards init --style X --scaffold` scaffold passes Ruff and Ty
 * as well as Inwards (#406), so its adapters really fit their Protocol ports
 * (the `if TYPE_CHECKING:` assignment at the end of each adapter module) and
 * the Django and FastAPI examples type-check against the real frameworks.
 * It needs uv and the network for the first run; CI's test job has no uv,
 * so there it returns at once, as the uv test in `init-style.test.ts` does.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findings, init, PASSING, STYLES, UV_PROJECT } from "../support/init-style-helpers.ts";
import { project } from "../support/run.ts";

const UV = Bun.which("uv");
/** Pinned, so a new release can't turn the suite red on its own. */
const RUFF = "ruff@0.17.0";
const TY = "ty@0.0.86";
/** What the Django and FastAPI scaffolds import. */
const DEPENDENCIES = ["django", "fastapi", "pydantic-settings"];

let venv = "";

/**
 * Runs a uv command and returns its exit code with the output, for a readable failure.
 *
 * @param exe - the uv executable.
 * @param args - the arguments after `uv`.
 * @param cwd - where to run it.
 * @returns the exit code and stdout and stderr together.
 */
function uv(exe: string, args: string[], cwd: string): { code: number; output: string } {
  const run = Bun.spawnSync([exe, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, output: `${run.stdout.toString()}${run.stderr.toString()}` };
}

beforeAll(() => {
  if (UV === null) {
    return;
  }
  const dir = project({});
  venv = join(dir, ".venv");
  for (const args of [
    ["venv", "-q", venv],
    ["pip", "install", "-q", "--python", venv, ...DEPENDENCIES],
  ]) {
    const run = uv(UV, args, dir);
    if (run.code !== 0) {
      throw new Error(`uv ${args.join(" ")} failed:\n${run.output}`);
    }
  }
}, 300_000);

describe("inwards init --style X --scaffold passes Ruff and Ty", () => {
  test.each([...STYLES])(
    "%s",
    (style) => {
      if (UV === null) {
        return; // CI's test job has no uv.
      }
      const root = project(UV_PROJECT);
      expect(init(root, "--style", style, "--scaffold").code).toBe(0);
      expect(findings(root)).toEqual(PASSING.check);
      expect(uv(UV, ["tool", "run", RUFF, "check", "-q", "."], root)).toEqual({
        code: 0,
        output: "",
      });
      const ty = uv(UV, ["tool", "run", TY, "check", "-q", "--python", venv, "."], root);
      expect(ty).toEqual({ code: 0, output: "" });
    },
    120_000,
  );
});
