/**
 * @file The daemon's request loop on a real socket (#277): a `stop` that
 * arrives while a hook run is in progress is answered at once instead of
 * waiting behind it, the run in progress still gets its answer, and a
 * request still waiting in the queue is dropped, so its hook runs in its own
 * process. The handler is a stub whose hook run waits until the test lets it
 * finish.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { nodeDaemonHost } from "../../src/adapters/daemon-host.ts";
import { nodeDaemonLink } from "../../src/adapters/daemon-link.ts";
import type { AskResult, LineHandler } from "../../src/daemon/contracts.ts";
import { daemonPlace } from "../../src/daemon/protocol.ts";
import { tempDir } from "../support/temp.ts";

const LIMITS = { connectMs: 2000, answerMs: 10_000 };
const POLL_MS = 10;

/**
 * Waits until a condition holds.
 *
 * @param ok - the condition.
 * @returns once it holds.
 */
async function until(ok: () => boolean): Promise<void> {
  while (!ok()) {
    // biome-ignore lint/performance/noAwaitInLoops: polling is the point.
    await Bun.sleep(POLL_MS);
  }
}

describe("the daemon's queue (#277)", () => {
  // `serve` moves into the state directory; the other test files expect the repository.
  const cwd = process.cwd();
  afterEach(() => {
    process.chdir(cwd);
  });

  test("stop is answered while a hook run is stuck, and the queued request is dropped", async () => {
    const root = tempDir("inwards-loop-");
    const sockets = tempDir("irt-");
    chmodSync(sockets, 0o700);
    const place = daemonPlace({ stateHome: join(root, "state") }, "/project");
    const seen: string[] = [];
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const handler: LineHandler = {
      tooLarge: "too-large\n",
      urgent(line: string): boolean {
        seen.push(line);
        return line === "stop";
      },
      async handle(line: string): Promise<{ answer: string; stop: boolean }> {
        if (line === "stop") {
          return { answer: "stopped\n", stop: true };
        }
        await gate;
        return { answer: `${line} done\n`, stop: false };
      },
    };
    let endpoint = "";
    // The socket goes in a short private directory of this test's own.
    const runtimeDir = process.env["XDG_RUNTIME_DIR"];
    process.env["XDG_RUNTIME_DIR"] = sockets;
    const serving = nodeDaemonHost().serve(place, handler, {
      idleMs: 60_000,
      record: (at: string): string => {
        endpoint = at;
        return "{}\n";
      },
      holds: (): Promise<boolean> => Promise.resolve(false),
    });
    try {
      await until(() => endpoint !== "");
    } finally {
      if (runtimeDir === undefined) {
        delete process.env["XDG_RUNTIME_DIR"];
      } else {
        process.env["XDG_RUNTIME_DIR"] = runtimeDir;
      }
    }
    const { ask } = nodeDaemonLink("");
    const stuck = ask(endpoint, "stuck\n", LIMITS);
    await until(() => seen.includes("stuck"));
    const queued = ask(endpoint, "queued\n", LIMITS);
    await until(() => seen.includes("queued"));

    const stop = await ask(endpoint, "stop\n", LIMITS);
    expect(stop).toEqual({ kind: "answer", line: "stopped" });
    release();
    expect(await stuck).toEqual<AskResult>({ kind: "answer", line: "stuck done" });
    expect(await queued).toEqual<AskResult>({ kind: "lost" });
    expect(await serving).toEqual({ kind: "served" });
  });
});
