/**
 * @file The hook's side of the daemon and the wire format, with a fake link
 * (ADR-039): what a request carries, which answers are trusted, when the hook
 * falls back to a one-shot run, and when it starts a daemon afterwards. No
 * process or socket is involved; `daemon.test.ts` runs the real one.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  askDaemon,
  BACKOFF_MS,
  backingOff,
  holdsLock,
  viaDaemon,
} from "../../src/daemon/client.ts";
import type { AskResult, LockHolder } from "../../src/daemon/contracts.ts";
import {
  type DaemonAnswer,
  type DaemonStatus,
  daemonEnabled,
  MAX_PAYLOAD_BYTES,
  PROTOCOL,
  parseAnswer,
  parseRecord,
  parseRequest,
  toLine,
} from "../../src/daemon/protocol.ts";
import {
  answered,
  fakeLink,
  PLACE,
  POST,
  RECORD,
  request,
  SELF,
} from "../support/daemon-helpers.ts";

const KEY = /^[0-9a-f]{16}$/u;
/** The wall clock in the back-off tests. */
const T0 = "2026-10-10T12:00:00.000Z";
const MS_PER_MINUTE = 60_000;

/**
 * Gives the time some minutes after `T0`.
 *
 * @param minutes - how long after.
 * @returns the time, ISO 8601.
 */
function after(minutes: number): string {
  return new Date(Date.parse(T0) + minutes * MS_PER_MINUTE).toISOString();
}

/**
 * Builds the note a daemon that couldn't listen leaves.
 *
 * @param at - when it failed.
 * @returns the note's text.
 */
function failureNote(at: string): string {
  return toLine({ protocol: PROTOCOL, at, why: "no private directory for the socket", pid: 9 });
}
const HOOK: Parameters<typeof viaDaemon>[2] = { place: PLACE, stdin: POST, version: SELF.version };

/**
 * Builds the client's I/O with collected output.
 *
 * @param opts - the switches and whether the project has session state.
 * @param opts.daemon - `INWARDS_DAEMON`.
 * @param opts.ci - `CI` is set.
 * @param opts.state - the project has `.inwards/state`.
 * @param opts.now - the wall clock, ISO 8601.
 * @returns the I/O and what it wrote.
 */
function clientIo(
  opts: { daemon?: "on" | "off" | "auto"; ci?: boolean; state?: boolean; now?: () => string } = {},
): {
  io: Parameters<typeof viaDaemon>[1];
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      runtime: {
        daemon: opts.daemon ?? "auto",
        ci: opts.ci ?? false,
        cwd: "/project",
        stdoutIsTTY: false,
        stateHome: "/state",
      },
      streams: { out: (t: string): number => out.push(t), err: (t: string): number => err.push(t) },
      probe: { kind: (): "dir" | undefined => (opts.state === false ? undefined : "dir") },
      state: { statePath: (p: string): string => `${p}/.inwards/state` },
      clock: { elapsed: (): number => 7, now: opts.now ?? ((): string => T0) },
    },
    out,
    err,
  };
}

describe("wire format", () => {
  test("a request with another protocol, version or executable is stale", () => {
    expect(parseRequest(JSON.stringify(request()), SELF)).toEqual(request());
    for (const patch of [{ protocol: "inwards-daemon/2" }, { version: "9" }, { identity: "x" }]) {
      expect(parseRequest(JSON.stringify({ ...request(), ...patch }), SELF)).toBe("stale");
    }
  });

  test("a request with the right stamp but a bad field is a protocol error", () => {
    expect(parseRequest("not json", SELF)).toBe("protocol");
    expect(parseRequest(JSON.stringify({ ...request(), env: { A: 1 } }), SELF)).toBe("protocol");
    expect(parseRequest(JSON.stringify({ ...request(), op: "exec" }), SELF)).toBe("protocol");
  });

  test("answers and records round-trip; foreign ones are refused", () => {
    const answer: DaemonAnswer = { protocol: PROTOCOL, exit: 2, stdout: "", stderr: "x\n" };
    expect(parseAnswer(toLine(answer))).toEqual(answer);
    expect(parseAnswer(JSON.stringify({ protocol: "other", exit: 0 }))).toBeUndefined();
    expect(parseRecord(RECORD)?.pid).toBe(42);
    expect(parseRecord("{")).toBeUndefined();
    expect(parseRecord(undefined)).toBeUndefined();
  });

  test("the daemon is off with INWARDS_DAEMON=0, and under CI unless INWARDS_DAEMON=1", () => {
    expect(daemonEnabled({ daemon: "auto", ci: false })).toBe(true);
    expect(daemonEnabled({ daemon: "auto", ci: true })).toBe(false);
    expect(daemonEnabled({ daemon: "on", ci: true })).toBe(true);
    expect(daemonEnabled({ daemon: "off", ci: false })).toBe(false);
  });

  test("a project's files are named by a 16-digit key under the state directory", () => {
    expect(PLACE.key).toMatch(KEY);
    // Native separators: on Windows these are \state\inwards\daemons\...
    expect(PLACE.record).toBe(join("/state", "inwards", "daemons", `${PLACE.key}.json`));
    expect(PLACE.lock).toBe(join("/state", "inwards", "daemons", `${PLACE.key}.lock`));
  });
});

describe("the hook's side", () => {
  test("an answer is written out and its exit code returned", async () => {
    const answer: DaemonAnswer = { protocol: PROTOCOL, exit: 2, stdout: "o", stderr: "e" };
    const { link, sent } = fakeLink(answered(answer));
    const { io, out, err } = clientIo();
    expect(await viaDaemon(link, io, HOOK)).toEqual({ kind: "answered", exit: 2 });
    expect([out, err]).toEqual([["o"], ["e"]]);
    const parsed = parseRequest(sent[0]?.trimEnd() ?? "", SELF);
    expect(parsed).toMatchObject({ op: "hook", stdin: POST, elapsed: 7, cwd: "/project" });
  });

  test.each<[string, AskResult, string | undefined]>([
    ["no record", { kind: "unreachable" }, undefined],
    ["nothing listening", { kind: "unreachable" }, RECORD],
    ["no answer", { kind: "lost" }, RECORD],
    ["a stale daemon", answered({ protocol: PROTOCOL, error: "stale" }), RECORD],
  ])("%s: one-shot, then start a daemon", async (_, result, record) => {
    const { link } = fakeLink(result, record);
    expect(await viaDaemon(link, clientIo().io, HOOK)).toEqual({ kind: "fallback", start: true });
  });

  test.each<[string, AskResult]>([
    ["a protocol error", answered({ protocol: PROTOCOL, error: "protocol" })],
    ["an unreadable answer", { kind: "answer", line: "garbage" }],
  ])("%s: one-shot, and start nothing", async (_, result) => {
    const { link } = fakeLink(result);
    expect(await viaDaemon(link, clientIo().io, HOOK)).toEqual({ kind: "fallback", start: false });
  });

  test.each<[string, ReturnType<typeof clientIo>, string]>([
    ["INWARDS_DAEMON=0", clientIo({ daemon: "off" }), POST],
    ["CI", clientIo({ ci: true }), POST],
    ["a payload over 16 MB", clientIo(), "x".repeat(MAX_PAYLOAD_BYTES + 1)],
  ])("%s: nothing is asked or started", async (_, { io }, stdin) => {
    const { link, sent } = fakeLink({ kind: "unreachable" });
    expect(await viaDaemon(link, io, { ...HOOK, stdin })).toEqual({
      kind: "fallback",
      start: false,
    });
    expect(sent).toEqual([]);
  });

  test("a project without session state gets no daemon started", async () => {
    const { link } = fakeLink({ kind: "unreachable" }, undefined);
    expect(await viaDaemon(link, clientIo({ state: false }).io, HOOK)).toEqual({
      kind: "fallback",
      start: false,
    });
  });

  test("a run of hooks starts at most one daemon per back-off period when none can listen (#275)", async () => {
    const files = new Map<string, string>();
    const { link } = fakeLink({ kind: "unreachable" }, "", files);
    let starts = 0;
    /**
     * Runs one PostToolUse; a daemon it starts fails to listen at once and leaves its note.
     *
     * @param now - when the hook runs.
     */
    async function hook(now: string): Promise<void> {
      const forwarded = await viaDaemon(link, clientIo({ now: () => now }).io, HOOK);
      if (forwarded.kind === "fallback" && forwarded.start) {
        starts += 1;
        files.set(PLACE.failed, failureNote(now));
      }
    }
    // One edit every 30 seconds for 14.5 minutes.
    for (let half = 0; half < 30; half += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: each hook must see the note the one before it left.
      await hook(after(half / 2));
    }
    expect(starts).toBe(Math.ceil((14.5 * MS_PER_MINUTE) / BACKOFF_MS));
  });

  test.each<[string, string, boolean]>([
    ["a failure a minute ago", after(-1), true],
    ["a failure at the back-off limit", after(-BACKOFF_MS / MS_PER_MINUTE), false],
    ["a failure dated in the far future (the clock was set back)", after(60), false],
    ["a failure with an unreadable time", "yesterday", false],
  ])("%s: backing off is %p", (_, at, expected) => {
    const note = { protocol: PROTOCOL, at, why: "x", pid: 9 };
    expect(backingOff(note, T0)).toBe(expected);
  });

  test("a stale or unreachable daemon isn't replaced while a start is backing off", async () => {
    const files = new Map([[PLACE.failed, failureNote(after(-1))]]);
    const { link } = fakeLink({ kind: "lost" }, RECORD, files);
    expect(await viaDaemon(link, clientIo().io, HOOK)).toEqual({ kind: "fallback", start: false });
  });

  test("status without a record reports the last failed start", async () => {
    const files = new Map([[PLACE.failed, failureNote(T0)]]);
    const { link, sent } = fakeLink({ kind: "unreachable" }, "", files);
    const { record, failure } = await askDaemon(link, PLACE, "status", SELF.version);
    expect(record).toBeUndefined();
    expect(failure).toMatchObject({ at: T0, why: "no private directory for the socket", pid: 9 });
    expect(sent).toEqual([]);
  });

  test("stop asks the daemon the record names", async () => {
    const { link, sent } = fakeLink(answered({ protocol: PROTOCOL, stopped: true }));
    const { record, answer } = await askDaemon(link, PLACE, "stop", SELF.version);
    expect(record?.endpoint).toBe("/run/inwards/abc");
    expect(answer).toEqual({ protocol: PROTOCOL, stopped: true });
    expect(JSON.parse(sent[0] ?? "")).toMatchObject({ op: "stop", version: SELF.version });
  });
});

/** What the lock names in the lock-check tests. */
const HOLDER: LockHolder = { pid: 42, token: "ab12" };

/**
 * Builds a status answer.
 *
 * @param patch - fields to replace.
 * @returns a status answer for `HOLDER`'s daemon.
 */
function statusAnswer(patch: Partial<DaemonStatus> = {}): AskResult {
  return answered({
    protocol: PROTOCOL,
    status: {
      pid: HOLDER.pid,
      project: "/project",
      endpoint: "/run/inwards/abc",
      version: SELF.version,
      started: "2026-10-10T00:00:00.000Z",
      requests: 0,
      idleMs: 600_000,
      token: HOLDER.token,
      ...patch,
    },
  });
}

describe("a starting daemon's lock check (#276)", () => {
  test("the lock is held when the daemon at the record repeats its pid and token", async () => {
    const { link, sent } = fakeLink(statusAnswer());
    expect(await holdsLock(link, PLACE, HOLDER, SELF.version)).toBe(true);
    expect(JSON.parse(sent[0] ?? "")).toMatchObject({ op: "status", version: SELF.version });
  });

  test.each<[string, AskResult, string, LockHolder]>([
    ["no record", statusAnswer(), "", HOLDER],
    ["nothing listening at the record", { kind: "unreachable" }, RECORD, HOLDER],
    ["no answer", { kind: "lost" }, RECORD, HOLDER],
    ["a stale daemon", answered({ protocol: PROTOCOL, error: "stale" }), RECORD, HOLDER],
    ["a daemon with another pid", statusAnswer({ pid: 7 }), RECORD, HOLDER],
    ["a daemon with another token", statusAnswer({ token: "cd34" }), RECORD, HOLDER],
    ["a lock without a token", statusAnswer({ token: "" }), RECORD, { pid: 42, token: "" }],
  ])("%s: the lock is stale", async (_, result, record, holder) => {
    const { link } = fakeLink(result, record);
    expect(await holdsLock(link, PLACE, holder, SELF.version)).toBe(false);
  });
});
