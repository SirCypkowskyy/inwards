/**
 * @file #134: a violation a file already had at session start is context, not a
 * block, in both the PostToolUse hook and the Stop gate. The projects mirror
 * the eval's seeded-* cases: the example app, the eval config, the fixture's
 * files, committed, then the edit the task asks for.
 */
import { describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inwards, payload, type RunResult } from "../support/run.ts";
import { git, ID, put, session, stop } from "../support/stop-helpers.ts";

const REPO = join(import.meta.dir, "../../../..");
const FIXTURES = join(REPO, "eval/fixtures/INW001");
const ORDER = "shop/domain/order.py";
const PLACE = "shop/application/place_order.py";

/**
 * Whether this git has `--no-lazy-fetch` (2.44+). Without it the hooks can't
 * read a file's start content safely, so every old violation blocks: tests
 * that expect one excused are skipped (`test.skipIf`) where it is missing.
 */
const NO_LAZY_FETCH = Bun.spawnSync(["git", "--no-lazy-fetch", "version"]).exitCode === 0;

/**
 * Starts a session on the example app with one eval fixture's files committed.
 *
 * @param fixture - the fixture's directory name under eval/fixtures/INW001.
 * @returns the project directory.
 */
function seeded(fixture: string): string {
  return session({}, (root) => {
    cpSync(join(REPO, "examples/clean-app/shop"), join(root, "shop"), { recursive: true });
    cpSync(join(REPO, "eval/pyproject.toml"), join(root, "pyproject.toml"));
    cpSync(join(FIXTURES, fixture, "files"), root, { recursive: true });
  });
}

/**
 * Rewrites a file the way the agent's Edit tool does, then sends PostToolUse.
 *
 * @param root - the project directory.
 * @param rel - the file, relative to the project.
 * @param edit - the text to replace, everywhere in the file, and its replacement.
 * @param opts - the session id (default the test session) and extra environment.
 * @param opts.id - the session id; the test session when left out.
 * @param opts.env - variables added to the hook's environment.
 * @returns the hook's exit code and output.
 * @throws {Error} when the file doesn't contain the text to replace (the fixture changed).
 */
function agentEdits(
  root: string,
  rel: string,
  edit: [from: string, to: string],
  opts: { id?: string; env?: Record<string, string> } = {},
): RunResult {
  const [from, to] = edit;
  const { id = ID, env = {} } = opts;
  const before = readFileSync(join(root, rel), "utf8");
  if (!before.includes(from)) {
    throw new Error(`${rel} has no ${JSON.stringify(from)}; the fixture changed`);
  }
  put(root, rel, before.replaceAll(from, to));
  const input = payload("post-write-order", root, {
    session_id: id,
    tool_input: { file_path: join(root, rel) },
  });
  return inwards(["hook", "claude-code"], { cwd: root, stdin: input, env });
}

/**
 * Sends a SessionStart or Stop event for a given session.
 *
 * @param root - the project directory.
 * @param event - `session-start` or `stop`, the payload fixture's name.
 * @param id - the session id.
 * @param env - extra environment.
 * @returns the hook's exit code and output.
 */
function send(
  root: string,
  event: "session-start" | "stop",
  id: string,
  env: Record<string, string> = {},
): RunResult {
  const stdin = payload(event, root, { session_id: id, source: "startup" });
  return inwards(["hook", "claude-code"], { cwd: root, stdin, env });
}

/**
 * Reads the violation fingerprints each run-log line recorded.
 *
 * @param root - the project directory.
 * @returns one list per logged run, in order.
 */
function loggedPrints(root: string): unknown[] {
  return readFileSync(join(root, ".inwards/runs.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).fingerprints);
}

/**
 * Reads the context a PostToolUse run handed back to the model.
 *
 * @param run - the hook's result.
 * @returns the `additionalContext` text.
 */
function contextOf(run: RunResult): string {
  return String(JSON.parse(run.stdout).hookSpecificOutput.additionalContext);
}

/** The seeded-function-import task: a `total_euros` property on `Order`. */
const EUROS: [string, string] = [
  "    total_cents: int\n",
  "    total_cents: int\n\n    @property\n    def total_euros(self) -> float:\n        return self.total_cents / 100\n",
];

/** Each seeded fixture, the file its task edits, and the edit the task asks for. */
const TASKS: [string, string, [string, string]][] = [
  ["seeded-function-import", ORDER, EUROS],
  [
    "seeded-relative-import",
    PLACE,
    [
      "    order = Order(",
      '    if total_cents < 0:\n        raise ValueError("total_cents must not be negative")\n    order = Order(',
    ],
  ],
  [
    "seeded-type-checking",
    ORDER,
    ["-> None:\n    repo.save", '-> None:\n    """Save the order."""\n    repo.save'],
  ],
];

/** The old import of seeded-function-import, as a second, top-level copy. */
const SECOND_COPY: [string, string] = [
  "from dataclasses",
  "from shop.infrastructure.sql_orders import SqlOrderRepository\nfrom dataclasses",
];

describe.skipIf(!NO_LAZY_FETCH)("violations a file had at session start are excused", () => {
  for (const [fixture, file, task] of TASKS) {
    test(`${fixture}: the task's edit and the Stop pass, the old violation is context`, () => {
      const root = seeded(fixture);
      const edit = agentEdits(root, file, task);
      expect(edit.code).toBe(0);
      expect(contextOf(edit)).toContain("already in the file when the session started");
      expect(contextOf(edit)).toContain("INW001");
      expect(stop(root).code).toBe(0);
    });
  }

  test("a second copy of the old import still blocks, and the old one is named as context", () => {
    const root = seeded("seeded-function-import");
    const edit = agentEdits(root, ORDER, SECOND_COPY);
    expect(edit.code).toBe(2);
    expect(edit.stderr).toContain("already in the file when the session started");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("already in the file when the session started");
    // Copies match by rule, module and message, not by line: one of the two blocks.
    expect(stderr).toContain('"violations":1,');
  });

  test("a change through Bash, which PostToolUse never sees, is judged the same way", () => {
    const root = seeded("seeded-type-checking");
    put(root, ORDER, `${readFileSync(join(root, ORDER), "utf8")}\nX = 1\n`);
    expect(stop(root).code).toBe(0);
  });

  test("a commit mid-session doesn't make the old violation new", () => {
    const root = seeded("seeded-function-import");
    agentEdits(root, ORDER, EUROS);
    git(root, "commit", "-qam", "agent");
    expect(stop(root).code).toBe(0);
  });

  test("a CRLF working tree over an LF commit (core.autocrlf) still proves the start content", () => {
    const root = seeded("seeded-function-import");
    put(root, ORDER, readFileSync(join(root, ORDER), "utf8").replaceAll("\n", "\r\n"));
    send(root, "session-start", "crlf");
    const edit = agentEdits(root, ORDER, ["    id: str\r\n", "    id: str\r\n    note: str\r\n"], {
      id: "crlf",
    });
    expect(edit.code).toBe(0);
    expect(send(root, "stop", "crlf").code).toBe(0);
  });

  test("excused violations stay out of the run log; a new one is logged", () => {
    const root = seeded("seeded-function-import");
    const env = { INWARDS_RUN_LOG: "1" };
    agentEdits(root, ORDER, EUROS, { env });
    send(root, "stop", ID, env);
    expect(loggedPrints(root)).toEqual([[], []]);
    agentEdits(root, ORDER, SECOND_COPY, { env });
    expect(loggedPrints(root).at(-1)).toHaveLength(1);
  });
});

describe("violations the hooks still block, and what they never run", () => {
  test("a different violation in the same file blocks", () => {
    const root = seeded("seeded-relative-import");
    agentEdits(root, PLACE, [
      "from ..domain.order",
      "from shop.api.http import post_order\nfrom ..domain.order",
    ]);
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("shop.api.http");
  });

  test("a file uncommitted at session start has no known start content, so it blocks as before", () => {
    const root = session({}, (dir) => put(dir, "shop/domain/order.py", "X = 1\n"));
    put(root, ORDER, "import shop.infrastructure.db\n");
    // A new session sees the uncommitted violation at its start.
    inwards(["hook", "claude-code"], {
      cwd: root,
      stdin: payload("session-start", root, { session_id: "dirty", source: "startup" }),
    });
    put(root, ORDER, "import shop.infrastructure.db\nX = 2\n");
    const run = inwards(["hook", "claude-code"], {
      cwd: root,
      stdin: payload("stop", root, { session_id: "dirty" }),
    });
    expect(run.code).toBe(2);
  });

  test("a smudge filter or fsmonitor the agent planted in git's config never runs", () => {
    const root = seeded("seeded-function-import");
    const marker = join(root, "MARKER");
    // Forward slashes: in a git config value a backslash starts an escape, and
    // Windows' `D:\a\...` would make the whole file unreadable to git.
    const run = `"sh -c 'echo pwned > ${marker.replaceAll("\\", "/")}; cat'"`;
    writeFileSync(join(root, ".gitattributes"), "*.py filter=pwn\n");
    appendFileSync(
      join(root, ".git/config"),
      `[filter "pwn"]\n\tsmudge = ${run}\n\tprocess = ${run}\n[core]\n\tfsmonitor = ${run}\n`,
    );
    // The planted commands are live: git reads the config, so a pass isn't a broken fixture.
    const planted = Bun.spawnSync(["git", "config", "--get", "filter.pwn.smudge"], { cwd: root });
    expect(planted.stdout.toString()).toContain("echo pwned");
    // Excused where the start blob can be read safely, blocked (the fallback) where it can't.
    const code = NO_LAZY_FETCH ? 0 : 2;
    expect(agentEdits(root, ORDER, EUROS).code).toBe(code);
    expect(stop(root).code).toBe(code);
    expect(existsSync(marker)).toBe(false);
  });

  for (const remote of ["ext", "ssh"]) {
    test(`a partial clone with an agent-chosen ${remote} fetch never fetches the start blob`, () => {
      const root = seeded("seeded-function-import");
      const marker = join(root, "MARKER");
      const blob = Bun.spawnSync(["git", "rev-parse", `HEAD:${ORDER}`], { cwd: root });
      const id = blob.stdout.toString().trim();
      rmSync(join(root, ".git/objects", id.slice(0, 2), id.slice(2)));
      const url =
        remote === "ext" ? `ext::sh -c touch% ${marker};sleep% 10` : "ssh://example.invalid/x";
      for (const [key, value] of [
        ["core.repositoryformatversion", "1"],
        ["extensions.partialClone", "origin"],
        ["remote.origin.promisor", "true"],
        ["remote.origin.url", url],
        ["protocol.allow", "always"],
        ["core.sshCommand", `touch ${marker}; sleep 10; false`],
      ]) {
        git(root, "config", key ?? "", value ?? "");
      }
      const started = performance.now();
      // No start content is provable any more, so the old violation blocks, as for an uncommitted file.
      expect(agentEdits(root, ORDER, EUROS).code).toBe(2);
      expect(stop(root).code).toBe(2);
      expect(performance.now() - started).toBeLessThan(8000);
      expect(existsSync(marker)).toBe(false);
    }, 30_000);
  }
});

describe.if(!NO_LAZY_FETCH)("git before 2.44, without --no-lazy-fetch", () => {
  test("on git before 2.44 an old violation blocks, the safe fallback", () => {
    const root = seeded("seeded-function-import");
    expect(agentEdits(root, ORDER, EUROS).code).toBe(2);
    expect(stop(root).code).toBe(2);
  });
});
