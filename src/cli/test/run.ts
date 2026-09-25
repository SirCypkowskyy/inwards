import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// CI sets INWARDS_BIN to the compiled binary; locally the tests run the source.
const REPO = resolve(import.meta.dir, "../../..");
const CMD = process.env.INWARDS_BIN
  ? [resolve(REPO, process.env.INWARDS_BIN)]
  : [process.execPath, join(REPO, "src/cli/src/main.ts")];

export function inwards(args: string[], opts: { cwd: string; stdin?: string }) {
  const p = Bun.spawnSync([...CMD, ...args], {
    cwd: opts.cwd,
    stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "" },
  });
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

export const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`;

/** A throwaway project: `{ "pyproject.toml": LAYERS, "shop/domain/order.py": "..." }`. */
export function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "inwards-e2e-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
