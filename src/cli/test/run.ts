import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// CI sets INWARDS_BIN to the compiled binary; locally the tests run the source.
const REPO = resolve(import.meta.dir, "../../..");
const CMD = process.env["INWARDS_BIN"]
  ? [resolve(REPO, process.env["INWARDS_BIN"])]
  : [process.execPath, join(REPO, "src/cli/src/main.ts")];

// FORCE_COLOR on purpose: hosts set it, and machine output must stay plain anyway.
// CLAUDE_PROJECT_DIR is dropped because these tests may run inside Claude Code.
const ENV: Record<string, string | undefined> = { ...process.env, NO_COLOR: "", FORCE_COLOR: "1" };
delete ENV["CLAUDE_PROJECT_DIR"];

export function inwards(
  args: string[],
  opts: { cwd: string; stdin?: string | undefined; env?: Record<string, string> },
) {
  const p = Bun.spawnSync([...CMD, ...args], {
    cwd: opts.cwd,
    stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
    env: { ...ENV, ...opts.env },
  });
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

export const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`;

const TMP = mkdtempSync(join(tmpdir(), "inwards-e2e-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

/** A throwaway project: `{ "pyproject.toml": LAYERS, "shop/domain/order.py": "..." }`. */
export function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(TMP, "p-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

/** A recorded Claude Code payload with `{{ROOT}}/a/b` turned into a native path under `root`. */
export function payload(name: string, root: string, patch: Record<string, unknown> = {}): string {
  const text = readFileSync(join(import.meta.dir, "fixtures/claude-code", `${name}.json`), "utf8");
  const rooted = (_: string, v: unknown) =>
    typeof v === "string" && v.startsWith("{{ROOT}}") ? join(root, v.slice(8)) : v;
  return JSON.stringify({ ...JSON.parse(text, rooted), ...patch });
}
