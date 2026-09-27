/**
 * @file Who trusts the extraction cache (#56). `inwards check` and
 * `inwards baseline` read and fill `.inwards/cache`; the Claude Code hooks
 * never touch it, so an entry planted by an agent (which can write the
 * project) can't hide a violation from PostToolUse or the Stop gate. The
 * documented trade-off is tested too: a planted entry does fool a cached
 * `inwards check`, and `--no-cache` or `INWARDS_NO_CACHE=1` sees through it.
 * Concurrent checks share the cache without corrupting it.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inwards, inwardsAsync, LAYERS, project } from "../support/run.ts";
import { agentWrites, LEAK, session, stop } from "../support/stop-helpers.ts";
import { ORDER, posted } from "../support/suppress-helpers.ts";

/**
 * Lists every file under a directory, recursively.
 *
 * @param dir - the directory.
 * @returns the files' absolute paths; none when the directory is missing.
 */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

/**
 * Rewrites the cache entries for a text so they claim it imports nothing,
 * as an agent planting a false entry would.
 *
 * @param root - the project directory.
 * @param text - the file text whose entries to poison.
 * @returns how many entries were rewritten.
 */
function poison(root: string, text: string): number {
  const hash = createHash("sha256").update(text).digest("hex");
  let planted = 0;
  for (const path of filesUnder(join(root, ".inwards", "cache"))) {
    const entry = JSON.parse(readFileSync(path, "utf8"));
    if (entry.textHash === hash) {
      entry.value = { skeleton: [], full: [], comments: [] };
      writeFileSync(path, JSON.stringify(entry));
      planted += 1;
    }
  }
  return planted;
}

/**
 * Runs `inwards check` in a project.
 *
 * @param root - the project directory.
 * @param args - extra arguments.
 * @param env - extra environment.
 * @returns the exit code.
 */
function check(root: string, args: string[] = [], env: Record<string, string> = {}): number {
  return inwards(["check", ...args], { cwd: root, env }).code;
}

describe("inwards check and baseline use the cache", () => {
  test("a check fills it; --no-cache and INWARDS_NO_CACHE=1 leave it alone", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    expect(check(root, ["--no-cache"])).toBe(1);
    expect(check(root, [], { INWARDS_NO_CACHE: "1" })).toBe(1);
    expect(existsSync(join(root, ".inwards", "cache"))).toBe(false);
    expect(check(root)).toBe(1);
    expect(filesUnder(join(root, ".inwards", "cache")).length).toBeGreaterThan(0);
  });

  test("baseline fills it unless told not to", () => {
    const off = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    expect(inwards(["baseline", "--no-cache"], { cwd: off }).code).toBe(0);
    expect(existsSync(join(off, ".inwards", "cache"))).toBe(false);
    const on = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    expect(inwards(["baseline"], { cwd: on }).code).toBe(0);
    expect(filesUnder(join(on, ".inwards", "cache")).length).toBeGreaterThan(0);
  });

  test("a planted entry fools a cached check, as documented; --no-cache sees through it", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    expect(check(root)).toBe(1);
    expect(poison(root, LEAK)).toBeGreaterThan(0);
    expect(check(root)).toBe(0);
    expect(check(root, ["--no-cache"])).toBe(1);
    expect(check(root, [], { INWARDS_NO_CACHE: "1" })).toBe(1);
  });

  test("concurrent checks agree and leave only whole entries", async () => {
    const files: Record<string, string> = { "pyproject.toml": LAYERS };
    for (let i = 0; i < 80; i += 1) {
      files[`shop/domain/m${i}.py`] = i % 4 === 0 ? LEAK : `X = ${i}\n`;
    }
    const root = project(files);
    const runs = await Promise.all(
      Array.from({ length: 4 }, () =>
        inwardsAsync(["check", "--format", "json"], { cwd: root, stdin: "" }),
      ),
    );
    const summaries = runs.map((r) => JSON.stringify(JSON.parse(r.stdout).diagnostics));
    expect(new Set(summaries).size).toBe(1);
    const entries = filesUnder(join(root, ".inwards", "cache"));
    expect(entries.some((p) => p.endsWith(".tmp"))).toBe(false);
    for (const path of entries) {
      expect(() => JSON.parse(readFileSync(path, "utf8"))).not.toThrow();
    }
    const warm = inwards(["check", "--format", "json"], { cwd: root });
    expect(JSON.stringify(JSON.parse(warm.stdout).diagnostics)).toBe(summaries[0] ?? "");
  });
});

describe("the hooks never read the cache", () => {
  test("a session's hooks write no cache", () => {
    const root = session();
    agentWrites(root, ORDER, LEAK);
    expect(stop(root).code).toBe(2);
    expect(existsSync(join(root, ".inwards", "cache"))).toBe(false);
  });

  test("a planted entry hides nothing from PostToolUse or the Stop gate", () => {
    const root = session();
    agentWrites(root, ORDER, LEAK);
    expect(check(root)).toBe(1);
    expect(poison(root, LEAK)).toBeGreaterThan(0);
    expect(check(root)).toBe(0); // the cached CLI check is fooled...
    const post = posted(root, ORDER);
    expect(`${post.stdout}${post.stderr}`).toContain("INW001"); // ...the hooks aren't
    const gate = stop(root);
    expect(gate.code).toBe(2);
    expect(gate.stderr).toContain('"code":"INW001"');
  });
});
