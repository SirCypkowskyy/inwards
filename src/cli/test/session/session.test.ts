import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { nodePlatform } from "../../src/adapters/compose.ts";
import { readSession } from "../../src/session/record.ts";

import { inwards, inwardsAsync, LAYERS, payload, project, type RunResult } from "../support/run.ts";

const IO = nodePlatform();

const ID = "session-test-1";

/**
 * Runs `inwards hook claude-code` in a project with the given payload.
 *
 * @param root - the project directory, used as the working directory.
 * @param stdin - the payload text.
 * @returns the exit code and output.
 */
function hook(root: string, stdin: string): RunResult {
  return inwards(["hook", "claude-code"], { cwd: root, stdin });
}

/**
 * Sends a recorded SessionStart payload for one session.
 *
 * @param root - the project directory.
 * @param id - the session id to report.
 * @param source - startup, resume, clear or compact.
 * @returns the exit code and output.
 */
function start(root: string, id: string = ID, source = "startup"): RunResult {
  return hook(root, payload("session-start", root, { session_id: id, source }));
}

/**
 * Builds a PostToolUse Write payload for one project file in the test session.
 *
 * @param root - the project directory.
 * @param file - the file, relative to the project.
 * @returns the payload as JSON text.
 */
function edit(root: string, file: string): string {
  return payload("post-write-order", root, {
    session_id: ID,
    tool_input: { file_path: join(root, file) },
  });
}

describe("session state", () => {
  test("SessionStart records every config and a manifest, silently", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      "pkg/pyproject.toml": LAYERS,
      "shop/domain/order.py": "X = 1\n",
    });
    expect(start(root)).toEqual({ code: 0, stdout: "", stderr: "" });
    const state = readSession(IO, realpathSync(root), ID);
    expect(Object.keys(state?.start.configs ?? {}).sort()).toEqual([
      "pkg/pyproject.toml",
      "pyproject.toml",
    ]);
    expect(Object.keys(state?.start.manifest ?? {})).toEqual([
      "shop/domain/order.py",
      "shop/infrastructure/db.py",
    ]);
    expect(state?.start.head).toBeNull(); // not a git repo
  });

  test("a project without [tool.inwards] gets no state", () => {
    const root = project({ "shop/domain/order.py": "X = 1\n" });
    start(root);
    expect(readdirSync(root)).not.toContain(".inwards");
  });

  test("edits and the fingerprints of their violations are recorded", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      "shop/domain/order.py": "import shop.infrastructure.db\n",
      "shop/domain/clean.py": "X = 1\n",
    });
    start(root);
    expect(hook(root, edit(root, "shop/domain/order.py")).code).toBe(2);
    expect(hook(root, edit(root, "shop/domain/order.py")).code).toBe(2);
    expect(hook(root, edit(root, "shop/domain/clean.py")).code).toBe(0);
    const state = readSession(IO, realpathSync(root), ID);
    expect(state?.edited).toEqual(["shop/domain/order.py", "shop/domain/clean.py"]);
    expect([...(state?.seen.values() ?? [])]).toEqual([2]); // one violation, seen twice
  });

  test("20 parallel hooks leave a log with every fingerprint", async () => {
    const files: Record<string, string> = { "pyproject.toml": LAYERS };
    for (let i = 0; i < 20; i += 1) {
      files[`shop/domain/f${i}.py`] = `import shop.infrastructure.m${i}\n`;
      files[`shop/infrastructure/m${i}.py`] = "";
    }
    const root = project(files);
    start(root);
    const runs = Array.from({ length: 20 }, (_, i) =>
      inwardsAsync(["hook", "claude-code"], {
        cwd: root,
        stdin: edit(root, `shop/domain/f${i}.py`),
      }),
    );
    expect((await Promise.all(runs)).map((r) => r.code)).toEqual(new Array<number>(20).fill(2));
    const state = readSession(IO, realpathSync(root), ID);
    expect(state?.edited).toHaveLength(20);
    expect(state?.seen.size).toBe(20);
  });

  test("a session id that isn't a plain name writes nothing", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    start(root, "../escape");
    expect(readdirSync(root)).not.toContain(".inwards");
  });

  test("deleting .inwards mid-session can't be undone by an edit, a resume or a compact", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    start(root);
    rmSync(join(root, ".inwards"), { recursive: true });
    hook(root, edit(root, "shop/domain/order.py"));
    start(root, ID, "compact");
    start(root, ID, "resume");
    expect(readSession(IO, realpathSync(root), ID)).toBeUndefined();
  });

  test("a resume keeps the original start", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    start(root);
    writeFileSync(join(root, "shop/domain/new.py"), "Y = 2\n");
    start(root, ID, "resume");
    const manifest = readSession(IO, realpathSync(root), ID)?.start.manifest ?? {};
    expect(Object.keys(manifest)).toEqual(["shop/domain/order.py", "shop/infrastructure/db.py"]);
  });

  test("a symlinked .inwards pointing outside the project is refused", () => {
    const outside = project({});
    writeFileSync(join(outside, "victim.jsonl"), "keep me\n");
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    symlinkSync(outside, join(root, ".inwards"));
    expect(start(root).code).toBe(1);
    expect(readdirSync(outside)).toEqual(["victim.jsonl"]);
  });

  test("a tampered log line is skipped, not fatal", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    start(root);
    writeFileSync(
      join(root, `.inwards/state/${ID}.jsonl`),
      '{"t":"edit","at":"x","file":"a.py","fingerprints":"not-an-array"}\n',
    );
    expect(readSession(IO, realpathSync(root), ID)?.edited).toEqual([]);
  });

  test("a new session prunes others past 50 or older than a week, never itself", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    const dir = join(root, ".inwards/state");
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 55; i += 1) {
      writeFileSync(join(dir, `old-${i}.jsonl`), "");
    }
    writeFileSync(join(dir, "ancient.start.json"), "{}");
    const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000;
    utimesSync(join(dir, "ancient.start.json"), eightDaysAgo, eightDaysAgo);
    start(root, "newest");
    const left = readdirSync(dir);
    expect(left.filter((n) => n.startsWith("old-")).length).toBe(49);
    expect(left).not.toContain("ancient.start.json");
    expect(left).toContain("newest.start.json");
  });

  test("edited paths stay project-relative when the payload names a symlinked path (macOS /var)", () => {
    const real = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    const link = `${real}-link`;
    symlinkSync(real, link);
    start(real);
    hook(real, edit(link, "shop/domain/order.py"));
    expect(readSession(IO, realpathSync(real), ID)?.edited).toEqual(["shop/domain/order.py"]);
  });

  test("resume and compact create nothing in a project without state", () => {
    const root = project({ "shop/domain/order.py": "X = 1\n" });
    start(root, ID, "resume");
    start(root, ID, "compact");
    expect(readdirSync(root)).not.toContain(".inwards");
  });

  test("a second startup, or one without a source, never resets the baseline", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    start(root);
    writeFileSync(join(root, "shop/domain/new.py"), "Y = 2\n");
    start(root);
    hook(root, payload("session-start", root, { session_id: "no-source", source: undefined }));
    const manifest = readSession(IO, realpathSync(root), ID)?.start.manifest ?? {};
    expect(Object.keys(manifest)).toEqual(["shop/domain/order.py", "shop/infrastructure/db.py"]);
    expect(readSession(IO, realpathSync(root), "no-source")).toBeUndefined();
  });
});
