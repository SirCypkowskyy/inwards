/**
 * @file When the OpenCode plugin's Stop gate runs, and what happens to its
 * message. The gate runs only after a turn a message started, not after a
 * shell command, a compaction or an abort. A message from the user, or a
 * turn without one, that starts while the Stop hook runs drops its result,
 * and the next idle checks again. A resumed session whose lookup failed is
 * still checked, and a gate message OpenCode took despite a failed request
 * is never sent twice.
 */
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  fire,
  type Hooks,
  initProject,
  LEAK,
  load,
  pause,
  STOP,
  say,
  slowHook,
} from "../support/opencode-helpers.ts";

/**
 * Fires a session.status event.
 *
 * @param hooks - the plugin's hooks.
 * @param id - the session.
 * @param type - `busy`, `retry` or `idle`.
 */
async function status(hooks: Hooks, id: string, type: string): Promise<void> {
  await hooks.event({
    event: { type: "session.status", properties: { sessionID: id, status: { type } } },
  });
}

test("the gate runs only after a turn a message started, not after a shell command or an abort", async () => {
  const root = initProject();
  const { hooks, sent } = await load(root);
  const s = "ses_pending";
  const order = join(root, "shop/domain/order.py");
  await fire(hooks, "session.created", s);
  await say(hooks, s, "Look around.");
  await fire(hooks, "session.idle", s); // clean
  writeFileSync(order, LEAK); // a shell command the user ran (`!cmd`), no turn
  await fire(hooks, "session.idle", s);
  expect(sent).toEqual([]);

  await say(hooks, s, "Add the import.");
  const aborted = { name: "MessageAbortedError", data: { message: "aborted" } };
  await hooks.event({
    event: { type: "session.error", properties: { sessionID: s, error: aborted } },
  });
  await fire(hooks, "session.idle", s); // the user pressed ESC
  expect(sent).toEqual([]);

  await say(hooks, s, "Go on.");
  const failed = { name: "APIError", data: { message: "overloaded" } };
  await hooks.event({
    event: { type: "session.error", properties: { sessionID: s, error: failed } },
  });
  await fire(hooks, "session.idle", s); // another error still ends a turn the gate checks
  expect(sent.map((m) => m.text.startsWith(STOP))).toEqual([true]);
});

test("a user message while the Stop hook runs drops its result, and the new turn is checked", async () => {
  const root = initProject();
  slowHook(root, 0.3);
  const { hooks, sent } = await load(root);
  const s = "ses_mid_hook";
  await fire(hooks, "session.created", s);
  await say(hooks, s, "Add the import.");
  writeFileSync(join(root, "shop/domain/order.py"), LEAK);
  const idle = fire(hooks, "session.idle", s);
  await pause(100);
  await say(hooks, s, "Never mind, leave it.");
  await idle;
  expect(sent).toEqual([]);
  await fire(hooks, "session.idle", s);
  expect(sent.map((m) => m.text.startsWith(STOP))).toEqual([true]);
});

test("a turn with no message that starts while the Stop hook runs leaves the check to the next idle", async () => {
  const root = initProject();
  slowHook(root, 0.3);
  const { hooks, sent } = await load(root);
  const s = "ses_retry_status";
  await fire(hooks, "session.created", s);
  await say(hooks, s, "Add the import.");
  writeFileSync(join(root, "shop/domain/order.py"), LEAK);
  const idle = fire(hooks, "session.idle", s);
  await pause(100);
  await status(hooks, s, "retry"); // counts as busy, as a `!cmd` or a compaction would
  await idle;
  expect(sent).toEqual([]);
  await status(hooks, s, "idle");
  await fire(hooks, "session.idle", s);
  expect(sent.map((m) => m.text.startsWith(STOP))).toEqual([true]);
});

test("a resumed session whose lookup failed when the user wrote is still checked at its idle", async () => {
  const root = initProject();
  const { hooks, sent } = await load(root, root, { get: 3 });
  const s = "ses_resumed_top"; // created before OpenCode restarted
  await say(hooks, s, "Add the import.");
  writeFileSync(join(root, "shop/domain/order.py"), LEAK);
  await fire(hooks, "session.idle", s);
  expect(sent.map((m) => m.text.startsWith(STOP))).toEqual([true]);
});

test("a gate message OpenCode takes before its request fails isn't sent again", async () => {
  const root = initProject();
  const s = "ses_taken";
  const order = join(root, "shop/domain/order.py");
  const ref: { hooks?: Hooks } = {};
  const { hooks, sent } = await load(root, root, {
    promptAt: [0],
    // OpenCode takes the message and the agent fixes the file; then the request reports a failure.
    during: async (call: number, text: string): Promise<void> => {
      if (call === 0 && ref.hooks) {
        await say(ref.hooks, s, text);
        writeFileSync(order, "X = 1\n");
      }
    },
  });
  ref.hooks = hooks;
  await fire(hooks, "session.created", s);
  await say(hooks, s, "Add the import.");
  writeFileSync(order, LEAK);
  await fire(hooks, "session.idle", s);
  await fire(hooks, "session.idle", s); // the continued turn ends clean
  expect(sent.filter((m) => m.text.startsWith(STOP))).toEqual([]);
});

test("a kept gate message that arrives after all isn't sent again at the next idle", async () => {
  const root = initProject();
  const kept: string[] = [];
  const { hooks, sent } = await load(root, root, {
    promptAt: [0, 1, 2],
    during: (_call: number, text: string): Promise<void> => {
      kept.push(text);
      return Promise.resolve();
    },
  });
  const s = "ses_late";
  const order = join(root, "shop/domain/order.py");
  await fire(hooks, "session.created", s);
  await say(hooks, s, "Add the import.");
  writeFileSync(order, LEAK);
  await fire(hooks, "session.idle", s); // three sends report a failure; the message is kept
  await say(hooks, s, kept[0] ?? ""); // OpenCode had taken one after all
  writeFileSync(order, "X = 1\n");
  await fire(hooks, "session.idle", s); // the continued turn ends clean
  expect(sent.filter((m) => m.text.startsWith(STOP))).toEqual([]);
});

/**
 * Runs a Stop check that answers late, with a shell command that rewrites
 * the domain module starting and ending while it runs.
 *
 * @param before - the module's text when the turn ends.
 * @param after - its text once the command ran.
 * @returns how many Stop gate messages were sent.
 */
async function commandDuringStop(before: string, after: string): Promise<number> {
  const root = initProject();
  slowHook(root, 1);
  const { hooks, sent } = await load(root);
  const s = "ses_cmd_cycle";
  const order = join(root, "shop/domain/order.py");
  await fire(hooks, "session.created", s);
  await say(hooks, s, "Edit the module.");
  writeFileSync(order, before);
  const first = fire(hooks, "session.idle", s); // the hook reads the module, then answers late
  await pause(700);
  await status(hooks, s, "busy"); // `!cmd`
  writeFileSync(order, after);
  await status(hooks, s, "idle");
  const second = fire(hooks, "session.idle", s);
  await Promise.all([first, second]);
  return sent.filter((m) => m.text.startsWith(STOP)).length;
}

test("a shell command that runs and ends while the Stop hook runs makes the gate check again", async () => {
  expect(await commandDuringStop(LEAK, "X = 1\n")).toBe(0); // the stale block isn't sent
  expect(await commandDuringStop("X = 1\n", LEAK)).toBe(1); // the stale pass doesn't hide the change
}, 30_000);

test("an abort of a turn whose session couldn't be looked up sends nobody back", async () => {
  const root = initProject();
  const { hooks, sent } = await load(root, root, { get: 3 });
  const s = "ses_resumed_abort";
  await say(hooks, s, "Add the import.");
  writeFileSync(join(root, "shop/domain/order.py"), LEAK);
  const aborted = { name: "MessageAbortedError", data: { message: "aborted" } };
  await hooks.event({
    event: { type: "session.error", properties: { sessionID: s, error: aborted } },
  });
  await fire(hooks, "session.idle", s);
  expect(sent).toEqual([]);
});

test("a gate message whose request threw isn't sent again at once, only at the next idle", async () => {
  const root = initProject();
  const calls: number[] = [];
  const { hooks, sent } = await load(root, root, {
    throwAt: [0],
    during: (call: number): Promise<void> => {
      calls.push(call);
      return Promise.resolve();
    },
  });
  const s = "ses_threw";
  await fire(hooks, "session.created", s);
  await say(hooks, s, "Add the import.");
  writeFileSync(join(root, "shop/domain/order.py"), LEAK);
  await fire(hooks, "session.idle", s);
  expect([calls.length, sent.length]).toEqual([1, 0]);
  await fire(hooks, "session.idle", s);
  expect(sent.map((m) => m.text.startsWith(STOP))).toEqual([true]);
});
