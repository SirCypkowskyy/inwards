/**
 * @file The daemon's side of a request and what it keeps between requests
 * (ADR-039), without a process: the handler runs only PostToolUse for
 * `hook claude-code`, retires itself on a stale request or a replaced
 * executable, and the extraction cache and git answers stay bounded and keyed
 * by content. The hook run is a stub that echoes its request, so these tests
 * see only the handler's decisions.
 */
import { describe, expect, test } from "bun:test";
import type { CachedExtraction, ExtractionIdentity } from "@inwards/core";
import { commitKeyedGit, daemonExtractionCache } from "../../src/daemon/memory.ts";
import { type HookRequest, PROTOCOL } from "../../src/daemon/protocol.ts";
import { createHandler, type HookOutcome } from "../../src/daemon/server.ts";
import type { Git } from "../../src/platform/contracts.ts";
import { request, SELF } from "../support/daemon-helpers.ts";

/**
 * Builds a handler whose hook run reports what it was given.
 *
 * @param identity - what the executable's identity is now.
 * @returns a line handler that parses its answers, and the requests it ran.
 */
function handler(identity: () => string | undefined = (): string => SELF.identity): {
  handle: (line: string) => Promise<{ answer: unknown; stop: boolean }>;
  ran: HookRequest[];
} {
  const ran: HookRequest[] = [];
  const h = createHandler(
    {
      ...SELF,
      currentIdentity: identity,
      status: () => ({
        pid: 1,
        project: "/project",
        endpoint: "/e",
        version: SELF.version,
        started: "t",
        idleMs: 600_000,
        token: "ab12",
      }),
    },
    (r: HookRequest): Promise<HookOutcome> => {
      ran.push(r);
      return Promise.resolve({ exit: 2, stdout: "", stderr: `ran ${r.cwd}` });
    },
  );
  return {
    handle: async (line: string): Promise<{ answer: unknown; stop: boolean }> => {
      const { answer, stop } = await h.handle(line);
      return { answer: JSON.parse(answer), stop };
    },
    ran,
  };
}

describe("the daemon's side", () => {
  test("a PostToolUse request runs the hook and is counted", async () => {
    const h = handler();
    expect(await h.handle(JSON.stringify(request()))).toEqual({
      answer: { protocol: PROTOCOL, exit: 2, stdout: "", stderr: "ran /project" },
      stop: false,
    });
    const status = await h.handle(JSON.stringify({ protocol: PROTOCOL, ...SELF, op: "status" }));
    expect(status.answer).toMatchObject({ status: { requests: 1, pid: 1 } });
  });

  test.each([
    ["Stop", request({ stdin: JSON.stringify({ hook_event_name: "Stop" }) })],
    ["PreToolUse", request({ stdin: JSON.stringify({ hook_event_name: "PreToolUse" }) })],
    ["SessionStart", request({ stdin: JSON.stringify({ hook_event_name: "SessionStart" }) })],
    ["inwards check", request({ argv: ["check"] })],
  ])("%s is refused: only PostToolUse runs here", async (_, refused) => {
    const h = handler();
    expect((await h.handle(JSON.stringify(refused))).answer).toEqual({
      protocol: PROTOCOL,
      error: "protocol",
    });
    expect(h.ran).toEqual([]);
  });

  test("a stale request, or a replaced executable, answers stale and stops the daemon", async () => {
    const stale = await handler().handle(JSON.stringify(request({ version: "0.0.1" })));
    expect(stale).toEqual({ answer: { protocol: PROTOCOL, error: "stale" }, stop: true });
    const replaced = handler(() => "/bin/inwards\u000011\u00002");
    expect(await replaced.handle(JSON.stringify(request()))).toMatchObject({ stop: true });
    expect(replaced.ran).toEqual([]);
  });

  test("stop answers, then stops", async () => {
    const stop = await handler().handle(
      JSON.stringify({ protocol: PROTOCOL, ...SELF, op: "stop" }),
    );
    expect(stop).toEqual({ answer: { protocol: PROTOCOL, stopped: true }, stop: true });
  });
});

describe("what the daemon keeps", () => {
  const value: CachedExtraction = { full: [] };
  /**
   * Names one text of a module.
   *
   * @param text - the file's text.
   * @param module - the module's name.
   * @returns the extraction identity.
   */
  function id(text: string, module = "shop.domain.order"): ExtractionIdentity {
    return { revision: "1", text, module, isPackage: false };
  }

  test("several texts of one module are kept, up to the per-module limit", () => {
    const cache = daemonExtractionCache({ entries: 100, bytes: 10_000, perModule: 2 });
    cache.set(id("start"), value);
    cache.set(id("edited"), value);
    expect(cache.get(id("start"))).toEqual(value);
    expect(cache.get(id("edited"))).toEqual(value);
    cache.set(id("edited again"), value);
    expect(cache.get(id("start"))).toBeUndefined();
    expect(cache.get(id("edited again"))).toEqual(value);
  });

  test("the entry limit evicts the least recently used", () => {
    const cache = daemonExtractionCache({ entries: 2, bytes: 10_000, perModule: 4 });
    cache.set(id("a", "a"), value);
    cache.set(id("b", "b"), value);
    cache.get(id("a", "a"));
    cache.set(id("c", "c"), value);
    expect(cache.get(id("b", "b"))).toBeUndefined();
    expect(cache.get(id("a", "a"))).toEqual(value);
  });

  test("git answers about a full commit id are kept; others and failures are not", () => {
    const calls: string[][] = [];
    const real: Git = {
      run: (_dir: string, args: string[]): string | undefined => {
        calls.push(args);
        return args.some((a) => a.endsWith(":missing")) ? undefined : `out ${calls.length}`;
      },
    };
    const git = commitKeyedGit(real);
    const commit = "a".repeat(40);
    const blob = ["--no-lazy-fetch", "cat-file", "blob", `${commit}:./shop/a.py`];
    expect(git.run("/p", blob)).toBe("out 1");
    expect(git.run("/p", blob)).toBe("out 1");
    expect(git.run("/q", blob)).toBe("out 2"); // another repository
    expect(git.run("/p", ["rev-parse", "HEAD"])).toBe("out 3");
    expect(git.run("/p", ["rev-parse", "HEAD"])).toBe("out 4");
    expect(git.run("/p", ["cat-file", "blob", "HEAD:./a.py"])).toBe("out 5");
    expect(git.run("/p", ["cat-file", "blob", "HEAD:./a.py"])).toBe("out 6");
    const missing = ["cat-file", "blob", `${commit}:missing`];
    expect(git.run("/p", missing)).toBeUndefined();
    expect(git.run("/p", missing)).toBeUndefined();
    expect(calls).toHaveLength(8);
  });
});
