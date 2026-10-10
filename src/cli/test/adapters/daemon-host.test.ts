/**
 * @file The daemon's host on the real filesystem when no socket directory is
 * usable (#275): it fails to listen, leaves a note beside its record and
 * releases its lock, and a hook that reads the note through the real link
 * starts no other daemon until the back-off period has passed. A daemon that
 * does listen removes the note. Unix only: Windows listens on a named pipe and
 * has no socket directory.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { nodeDaemonHost } from "../../src/adapters/daemon-host.ts";
import { nodeDaemonLink } from "../../src/adapters/daemon-link.ts";
import { viaDaemon } from "../../src/daemon/client.ts";
import type { LineHandler, ServeOptions } from "../../src/daemon/contracts.ts";
import { daemonPlace, PROTOCOL, parseFailure, toLine } from "../../src/daemon/protocol.ts";
import { POST } from "../support/daemon-helpers.ts";
import { tempDir } from "../support/temp.ts";

const FAILED_AT = "2026-10-10T12:00:00.000Z";
const LATER = "2026-10-10T12:04:00.000Z";
const MUCH_LATER = "2026-10-10T12:06:00.000Z";
/** Longer than the 103 bytes a socket path may take. */
const LONG_NAME = "d".repeat(120);

/** A handler that answers nothing; no request reaches it in these tests. */
const HANDLER: LineHandler = {
  handle: (): Promise<{ answer: string; stop: boolean }> =>
    Promise.resolve({ answer: "", stop: true }),
  tooLarge: "",
};

/**
 * Builds the serve options, with a 50 ms idle limit so a daemon that listens returns soon.
 *
 * @returns the options; the note says the start failed at `FAILED_AT`.
 */
function options(): ServeOptions {
  return {
    idleMs: 50,
    record: (endpoint: string): string =>
      toLine({
        protocol: PROTOCOL,
        version: "0",
        identity: "x",
        pid: process.pid,
        endpoint,
        project: "/project",
        started: FAILED_AT,
      }),
    failure: (why: string): string =>
      toLine({ protocol: PROTOCOL, at: FAILED_AT, why, pid: process.pid }),
    holds: (): Promise<boolean> => Promise.resolve(false),
  };
}

/**
 * Makes socket directories that `daemon-host.ts` must refuse: one others can
 * open (mode 0755), one link to a private directory, and one private
 * directory whose socket path would be too long.
 *
 * @param root - where to make them.
 * @returns the candidates, in order.
 */
function unusableDirs(root: string): string[] {
  const open = join(root, "open");
  mkdirSync(open);
  chmodSync(open, 0o755);
  const target = join(root, "target");
  mkdirSync(target, { mode: 0o700 });
  const link = join(root, "link");
  symlinkSync(target, link);
  const long = join(root, LONG_NAME);
  mkdirSync(long, { mode: 0o700 });
  return [open, link, long];
}

describe.skipIf(process.platform === "win32")("no usable socket directory (#275)", () => {
  test("the daemon fails, leaves a note and releases its lock; hooks back off", async () => {
    const root = tempDir("inwards-host-");
    const place = daemonPlace({ stateHome: join(root, "state") }, "/project");
    const dirs = unusableDirs(root);
    const result = await nodeDaemonHost(() => dirs).serve(place, HANDLER, options());
    expect(result).toEqual({ kind: "failed", why: "no private directory for the socket" });
    expect(existsSync(place.lock)).toBe(false);
    expect(parseFailure(readFileSync(place.failed, "utf8"))).toMatchObject({
      at: FAILED_AT,
      why: "no private directory for the socket",
    });

    // The real link reads the note; nothing listens, and the project has session state.
    const link = {
      ...nodeDaemonLink(""),
      identity: (): string => "x",
      start: (): void => undefined,
    };
    /**
     * Runs one PostToolUse through the real link's reads.
     *
     * @param now - when the hook runs.
     * @returns true when the hook would start a daemon.
     */
    async function hookAt(now: string): Promise<boolean> {
      const forwarded = await viaDaemon(
        link,
        {
          runtime: { daemon: "on", ci: false, cwd: "/project", stdoutIsTTY: false, stateHome: "" },
          streams: { out: (): undefined => undefined, err: (): undefined => undefined },
          probe: { kind: (): "dir" => "dir" },
          state: { statePath: (p: string): string => p },
          clock: { elapsed: (): number => 0, now: (): string => now },
        },
        { place, stdin: POST, version: "0" },
      );
      return forwarded.kind === "fallback" && forwarded.start;
    }
    expect(await hookAt(LATER)).toBe(false);
    expect(await hookAt(MUCH_LATER)).toBe(true);
  });

  test("a daemon that listens removes the note of an earlier failure", async () => {
    const root = tempDir("inwards-host-");
    const place = daemonPlace({ stateHome: join(root, "state") }, "/project");
    const failing = await nodeDaemonHost(() => unusableDirs(root)).serve(place, HANDLER, options());
    expect(failing.kind).toBe("failed");
    expect(existsSync(place.failed)).toBe(true);
    // A short private directory, as a usable `$XDG_RUNTIME_DIR` would give.
    const usable = tempDir("irt-");
    chmodSync(usable, 0o700);
    const served = await nodeDaemonHost(() => [usable]).serve(place, HANDLER, options());
    expect(served).toEqual({ kind: "served" });
    expect(existsSync(place.failed)).toBe(false);
    expect(existsSync(place.lock)).toBe(false);
  });
});
