/**
 * @file The daemon's lock on the real filesystem (#276): a lock is held only
 * while its pid is another live process and either the lock is young enough
 * that its daemon may still be starting or that daemon proves it holds the
 * lock. A pid the OS gave to another process, including this one, doesn't
 * keep a dead daemon's lock. The proof itself is faked here; the CLI's
 * `daemon.test.ts` runs it against a real daemon.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { releaseLock, takeLock } from "../../src/adapters/daemon-files.ts";
import type { LockHolder } from "../../src/daemon/contracts.ts";
import { tempDir } from "../support/temp.ts";

const dir = tempDir("inwards-lock-");
const TOKEN = "0123456789abcdef";
/** A minute ago, in seconds since the epoch: past the lock's start-up grace. */
const OLD_SECONDS = Date.now() / 1000 - 60;
/** A live process that isn't a daemon: the one that started this test run. */
const OTHER: number = process.ppid;

/**
 * Writes a lock file, as a daemon that took it would have.
 *
 * @param name - the lock's file name.
 * @param text - its content.
 * @param old - set its modification time a minute back.
 * @returns the lock's path.
 */
function lock(name: string, text: string, old = true): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  if (old) {
    utimesSync(path, OLD_SECONDS, OLD_SECONDS);
  }
  return path;
}

/**
 * Builds a lock check that always gives one answer and notes what it was asked.
 *
 * @param answer - whether a daemon proves it holds the lock.
 * @returns the check and the holders it was asked about.
 */
function proof(answer: boolean): {
  holds: (holder: LockHolder) => Promise<boolean>;
  asked: LockHolder[];
} {
  const asked: LockHolder[] = [];
  return {
    holds: (holder: LockHolder): Promise<boolean> => {
      asked.push(holder);
      return Promise.resolve(answer);
    },
    asked,
  };
}

/**
 * Gives the pid of a process that has exited.
 *
 * @returns a pid nothing runs under, unless the OS has already reused it.
 */
function deadPid(): number {
  const done = Bun.spawnSync([process.execPath, "--version"], { stdout: "ignore" });
  return done.pid;
}

describe("taking the daemon's lock", () => {
  test("a free lock is taken with this pid and the token", async () => {
    const path = join(dir, "free.lock");
    expect(await takeLock(path, TOKEN, proof(false).holds)).toBeUndefined();
    expect(readFileSync(path, "utf8")).toBe(`${process.pid} ${TOKEN}`);
  });

  test("a live pid that no daemon answers for doesn't keep an old lock", async () => {
    const path = lock("reused.lock", `${OTHER} feedface`);
    const { holds, asked } = proof(false);
    expect(await takeLock(path, TOKEN, holds)).toBeUndefined();
    expect(asked).toEqual([{ pid: OTHER, token: "feedface" }]);
    expect(readFileSync(path, "utf8")).toBe(`${process.pid} ${TOKEN}`);
  });

  test("an old lock whose daemon answers for it stays held", async () => {
    const path = lock("held.lock", `${OTHER} feedface`);
    expect(await takeLock(path, TOKEN, proof(true).holds)).toBe(OTHER);
    expect(readFileSync(path, "utf8")).toBe(`${OTHER} feedface`);
  });

  test("a young lock with a live pid is held without asking: its daemon may be starting", async () => {
    const path = lock("young.lock", `${OTHER} feedface`, false);
    const { holds, asked } = proof(false);
    expect(await takeLock(path, TOKEN, holds)).toBe(OTHER);
    expect(asked).toEqual([]);
  });

  test("a lock naming this process's own pid with another token is stale", async () => {
    const path = lock("self.lock", `${process.pid} feedface`, false);
    const { holds, asked } = proof(true);
    expect(await takeLock(path, TOKEN, holds)).toBeUndefined();
    expect(asked).toEqual([]);
  });

  test("a lock whose pid is gone is taken without asking", async () => {
    const path = lock("dead.lock", `${deadPid()} feedface`, false);
    const { holds, asked } = proof(true);
    expect(await takeLock(path, TOKEN, holds)).toBeUndefined();
    expect(asked).toEqual([]);
  });

  test("an old lock with only a pid, as earlier builds wrote, is checked with an empty token", async () => {
    const path = lock("legacy.lock", String(OTHER));
    const { holds, asked } = proof(false);
    expect(await takeLock(path, TOKEN, holds)).toBeUndefined();
    expect(asked).toEqual([{ pid: OTHER, token: "" }]);
  });
});

describe("releasing the daemon's lock", () => {
  test("only the pid and token that took it remove it", () => {
    const path = lock("release.lock", `${process.pid} ${TOKEN}`, false);
    releaseLock(path, "feedface");
    expect(existsSync(path)).toBe(true);
    releaseLock(path, TOKEN);
    expect(existsSync(path)).toBe(false);
  });
});
