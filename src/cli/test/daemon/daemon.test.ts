/**
 * @file `inwards daemon` as a real process (ADR-039): every recorded hook
 * fixture gives the same exit code and output through the daemon as in the
 * hook's own process; a hook with no daemon runs one-shot and starts one; a
 * second daemon for the same project steps aside, but a lock left by a dead
 * daemon whose pid now names another process doesn't stop one; an idle daemon exits and
 * cleans up; and `status` and `stop` report what runs. Every daemon these
 * tests start is stopped in `afterAll`, and each has a short idle limit as a
 * second guard, so none outlives the run.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import process from "node:process";
import { daemonPlace, PROTOCOL, toLine } from "../../src/daemon/protocol.ts";
import {
  CMD,
  inwards,
  inwardsAsync,
  LAYERS,
  payload,
  project,
  type RunResult,
} from "../support/run.ts";
import { ID, LEAK, session } from "../support/stop-helpers.ts";
import { STATE_HOME, tempDir } from "../support/temp.ts";

/**
 * A short private directory for the sockets: macOS's socket paths can't
 * exceed 104 bytes, and its temporary directory is already long.
 */
const RUNTIME_DIR: string = mkdtempSync(join(tmpdir(), "irt-"));
/** The environment that turns the daemon on for one run. */
const ON: Record<string, string> = { INWARDS_DAEMON: "1", CI: "", XDG_RUNTIME_DIR: RUNTIME_DIR };
/** The environment that keeps a run in its own process. */
const OFF = { INWARDS_DAEMON: "0" };
const DURATION = /"durationMs":[\d.]+/gu;
const JSON_SUFFIX = /\.json$/u;
const SERVED = /(?<count>\d+) hook runs served/u;
/** How long to wait for a daemon to come up or go away. */
const WAIT_MS = 15_000;
const POLL_MS = 50;
/** Well under the 60 s the fake git hangs for, and over the daemon's 5 s git budget. */
const GIT_HANG_MS = 20_000;

/** Every project a test started a daemon in, stopped after the run. */
const started: string[] = [];
/** The daemons started in the foreground, killed if `stop` didn't end them. */
const children: ReturnType<typeof Bun.spawn>[] = [];

afterAll(async () => {
  for (const root of started) {
    inwards(["daemon", "stop"], { cwd: root, env: ON });
  }
  for (const child of children) {
    child.kill();
  }
  await Promise.all(children.map((child) => child.exited));
  // A daemon a hook started isn't our child: wait until each one has released
  // its lock, the last thing it does before it exits.
  await until(() => started.every((root) => !existsSync(place(root).lock)));
  rmSync(RUNTIME_DIR, { recursive: true, force: true });
}, WAIT_MS * 2);

/**
 * Names a test project's daemon files.
 *
 * @param root - the project.
 * @returns its record and lock under the tests' state directory.
 */
function place(root: string): ReturnType<typeof daemonPlace> {
  return daemonPlace({ stateHome: STATE_HOME }, realpathSync(root));
}

/**
 * Starts `inwards daemon` in the foreground for a project and waits until it answers.
 *
 * @param root - the project.
 * @param idle - the idle limit in seconds.
 * @param env - variables added to the daemon's environment.
 * @returns the daemon process.
 */
async function startDaemon(
  root: string,
  idle = 120,
  env: Record<string, string> = {},
): Promise<ReturnType<typeof Bun.spawn>> {
  started.push(root);
  const child = Bun.spawn([...CMD, "daemon", "--idle", String(idle)], {
    cwd: root,
    env: { ...process.env, ...ON, XDG_STATE_HOME: STATE_HOME, ...env },
    stdout: "ignore",
    stderr: "ignore",
  });
  children.push(child);
  await until(() => status(root).code === 0);
  return child;
}

/**
 * Runs `inwards daemon status` for a project.
 *
 * @param root - the project.
 * @returns the exit code and output.
 */
function status(root: string): RunResult {
  return inwards(["daemon", "status"], { cwd: root, env: ON });
}

/**
 * Waits for a condition, polling.
 *
 * @param ok - the condition.
 * @param deadline - when to give up, on the `Date.now()` clock.
 * @returns once it holds.
 * @throws {Error} when it doesn't hold within `WAIT_MS`.
 */
async function until(ok: () => boolean, deadline = Date.now() + WAIT_MS): Promise<void> {
  if (ok()) {
    return;
  }
  if (Date.now() > deadline) {
    throw new Error("timed out waiting for the daemon");
  }
  await Bun.sleep(POLL_MS);
  await until(ok, deadline);
}

/**
 * Reads how many hook runs a daemon has served, from `inwards daemon status`.
 *
 * @param root - the project.
 * @returns the count, or -1 when no daemon answers.
 */
function served(root: string): number {
  const count = SERVED.exec(status(root).stdout)?.groups?.["count"];
  return count === undefined ? -1 : Number(count);
}

/**
 * Runs the hook with a fixture and makes the output comparable across projects.
 *
 * @param root - the project.
 * @param name - the fixture.
 * @param env - the daemon switch.
 * @returns the exit code and output, with the project path and durations masked.
 */
function hook(root: string, name: string, env: Record<string, string>): RunResult {
  const run = inwards(["hook", "claude-code"], { cwd: root, stdin: payload(name, root), env });
  return { code: run.code, stdout: mask(root, run.stdout), stderr: mask(root, run.stderr) };
}

/**
 * Masks what differs between two projects' output.
 *
 * @param root - the project.
 * @param s - stdout or stderr.
 * @returns the text with the root as `<root>` and durations as 0.
 */
function mask(root: string, s: string): string {
  return s
    .replaceAll(realpathSync(root), "<root>")
    .replaceAll(root, "<root>")
    .replace(DURATION, '"durationMs":0');
}

const FILES = { "shop/domain/order.py": "import shop.infrastructure.db\n", "README.md": "hi" };

describe("inwards daemon", () => {
  test("every hook fixture answers the same through the daemon as one-shot", async () => {
    const oneShot = project({ "pyproject.toml": LAYERS, ...FILES });
    const resident = project({ "pyproject.toml": LAYERS, ...FILES });
    await startDaemon(resident);
    const fixtures = readdirSync(join(import.meta.dir, "../support/fixtures/claude-code"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(JSON_SUFFIX, ""))
      .sort();
    for (const name of fixtures) {
      expect({ name, ...hook(resident, name, ON) }).toEqual({
        name,
        ...hook(oneShot, name, OFF),
      });
    }
    // Only the PostToolUse fixtures went through it; the others ran in the hook's own process.
    expect(served(resident)).toBe(fixtures.filter((f) => f.startsWith("post-")).length);
  });

  test("a config error reaches the agent the same way through the daemon", async () => {
    const broken = { "pyproject.toml": "[tool.inwards]\nlayers = []\n", ...FILES };
    const oneShot = project(broken);
    const resident = project(broken);
    await startDaemon(resident);
    const through = hook(resident, "post-write-order", ON);
    expect(through.code).toBe(2);
    expect(through).toEqual(hook(oneShot, "post-write-order", OFF));
  });

  test("with no daemon, the hook runs one-shot and starts one for a project with session state", async () => {
    const root = project({ "pyproject.toml": LAYERS, ...FILES });
    started.push(root);
    expect(hook(root, "session-start", ON).code).toBe(0);
    const first = hook(root, "post-write-order", ON);
    expect(first.stdout).toContain("already in the file when the session started");
    await until(() => served(root) === 0);
    expect(hook(root, "post-write-order", ON)).toEqual(first);
    expect(served(root)).toBe(1);
  });

  test("a project without session state gets no daemon", async () => {
    const root = project({ "pyproject.toml": LAYERS, ...FILES });
    expect(hook(root, "post-write-order", ON).code).toBe(2);
    await Bun.sleep(500);
    expect(status(root).code).toBe(1);
    expect(existsSync(place(root).record)).toBe(false);
  });

  test("a second daemon for the same project steps aside", async () => {
    const root = project({ "pyproject.toml": LAYERS, ...FILES });
    await startDaemon(root);
    const second = inwards(["daemon", "--idle", "5"], { cwd: root, env: ON });
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("already running");
  });

  test("a dead daemon's lock naming a live process that isn't a daemon doesn't stop a new one (#276)", async () => {
    const root = project({ "pyproject.toml": LAYERS, ...FILES });
    const files = place(root);
    mkdirSync(dirname(files.lock), { recursive: true });
    // The OS gave the dead daemon's pid to this test, and its record names an
    // endpoint nobody listens on. A lock with only the pid, as builds before
    // #276 wrote, kept every later daemon out.
    writeFileSync(files.lock, String(process.pid));
    const minuteAgo = Date.now() / 1000 - 60;
    utimesSync(files.lock, minuteAgo, minuteAgo);
    writeFileSync(
      files.record,
      toLine({
        protocol: PROTOCOL,
        version: "0.0.0",
        identity: "gone",
        pid: process.pid,
        endpoint: join(RUNTIME_DIR, "gone"),
        project: realpathSync(root),
        started: "2026-10-10T00:00:00.000Z",
      }),
    );
    await startDaemon(root);
    expect(status(root).stdout).not.toContain(`pid ${process.pid},`);
    // The new daemon's lock proves itself over its socket, so a third one still steps aside.
    utimesSync(files.lock, minuteAgo, minuteAgo);
    const third = inwards(["daemon", "--idle", "5"], { cwd: root, env: ON });
    expect(third.stdout).toContain("already running");
  });

  test("status says why the last start failed (#275)", () => {
    const root = project({ "pyproject.toml": LAYERS, ...FILES });
    const files = place(root);
    mkdirSync(dirname(files.failed), { recursive: true });
    writeFileSync(
      files.failed,
      toLine({
        protocol: PROTOCOL,
        at: "2026-10-10T12:00:00.000Z",
        why: "no private directory for the socket",
        pid: 77,
      }),
    );
    const shown = status(root);
    expect(shown.code).toBe(1);
    expect(shown.stderr).toContain("not running");
    expect(shown.stderr).toContain(
      "the last start (pid 77, 2026-10-10T12:00:00.000Z) couldn't listen: no private directory for the socket.",
    );
  });

  test("an idle daemon exits and removes its record and lock", async () => {
    const root = project({ "pyproject.toml": LAYERS, ...FILES });
    const child = await startDaemon(root, 1);
    expect(await child.exited).toBe(0);
    const files = place(root);
    expect(existsSync(files.record)).toBe(false);
    expect(existsSync(files.lock)).toBe(false);
    expect(status(root).code).toBe(1);
  });

  test("stop ends it; status and stop say when nothing runs", async () => {
    const root = project({ "pyproject.toml": LAYERS, ...FILES });
    const child = await startDaemon(root);
    expect(inwards(["daemon", "stop"], { cwd: root, env: ON }).stdout).toContain("stopped");
    expect(await child.exited).toBe(0);
    expect(status(root)).toMatchObject({ code: 1, stderr: expect.stringContaining("not running") });
    expect(inwards(["daemon", "stop"], { cwd: root, env: ON }).code).toBe(0);
    expect(inwards(["daemon", "restart"], { cwd: root, env: ON }).code).toBe(2);
    expect(inwards(["daemon", "--idle", "soon"], { cwd: root, env: ON }).code).toBe(2);
  });
});

// A shell script stands in for git, so this one runs on Unix only.
describe.skipIf(process.platform === "win32")("inwards daemon with a hung git", () => {
  test(
    "a hung git holds a hook run only for the git budget, and stop works meanwhile (#277)",
    async () => {
      // A git repository with a started session, so PostToolUse reads the
      // file's session-start text from git.
      const resident = session({ "shop/domain/order.py": LEAK });
      // A git that never answers and ignores SIGTERM, first on the daemon's PATH.
      const bin = tempDir("inwards-hung-git-");
      const calls = join(bin, "calls");
      writeFileSync(
        join(bin, "git"),
        `#!/bin/sh\necho "$@" >> '${calls}'\ntrap '' TERM\nexec sleep 60\n`,
      );
      chmodSync(join(bin, "git"), 0o755);
      const child = await startDaemon(resident, 120, {
        PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
      });
      const begun = performance.now();
      const through = inwardsAsync(["hook", "claude-code"], {
        cwd: resident,
        stdin: payload("post-write-order", resident, { session_id: ID }),
        env: ON,
      });
      await until(() => existsSync(calls));
      const stop = await inwardsAsync(["daemon", "stop"], { cwd: resident, stdin: "", env: ON });
      expect(stop.stdout).toContain("stopped");
      const answered = await through;
      // The budget is 5 s; a git left to hang would take 60.
      expect(performance.now() - begun).toBeLessThan(GIT_HANG_MS);
      expect(await child.exited).toBe(0);
      expect(readFileSync(calls, "utf8")).toContain("cat-file");
      // The violation is still reported; only the session-start split is lost.
      expect(answered.code).toBe(2);
      expect(answered.stderr).toContain("INW001");
    },
    WAIT_MS * 2,
  );
});
