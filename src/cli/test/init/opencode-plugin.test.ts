/**
 * @file The OpenCode plugin through a session. A bad edit gets its findings
 * in the tool result, and warnings reach the agent too. The Stop gate sends
 * the agent back once, as the agent the user picked, with a preface that
 * says who is speaking. A Stop result from before the user's latest
 * message, or a second idle while the first is being answered, sends
 * nothing. Subagents share their top-level session, including one resumed
 * after a restart, and a plugin file changed during the session is reported.
 */
import { expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_MARKER } from "../../src/claude-code/hook-host.ts";
import { fire, initProject, load, PLUGIN, say } from "../support/opencode-helpers.ts";

const STOP = "Inwards Stop gate (sent by the Inwards plugin, not the user)";
const LEAK = "import shop.infrastructure.db\n";

test("a bad edit gets its findings, and the Stop gate sends the agent back once, as the chosen agent", async () => {
  const root = initProject();
  const { hooks, sent } = await load(root);
  const s = "ses_stop";
  await fire(hooks, "session.created", s);
  await say(hooks, s, "Add the import.", { agent: "reviewer", variant: "high" });
  const order = join(root, "shop/domain/order.py");
  writeFileSync(order, LEAK);
  const out = { output: "Edit applied." };
  await hooks["tool.execute.after"](
    { tool: "write", sessionID: s, args: { filePath: order } },
    out,
  );
  expect(out.output).toContain("INW001");

  await fire(hooks, "session.idle", s);
  expect(sent.map((m) => [m.id, m.agent, m.variant, m.noReply])).toEqual([
    [s, "reviewer", "high", false],
  ]);
  expect(sent[0]?.text).toStartWith(STOP);
  expect(sent[0]?.text).toContain("INW001");

  await fire(hooks, "session.idle", s); // an idle from before the gate's message arrived
  expect(sent).toHaveLength(1);
  await say(hooks, s, sent[0]?.text ?? ""); // the gate's message arrives
  writeFileSync(order, "X = 1\n");
  await fire(hooks, "session.idle", s);
  expect(sent).toHaveLength(1);
});

test("a warning reaches the agent in the tool result", async () => {
  const root = initProject();
  const { hooks } = await load(root);
  const util = join(root, "shop/util.py");
  writeFileSync(util, "X = 1\n");
  const out = { output: "" };
  await hooks["tool.execute.after"](
    { tool: "write", sessionID: "ses_warn", args: { filePath: util } },
    out,
  );
  expect(out.output).toContain("INW006");
});

test("a Stop result from before the user's latest message sends nothing", async () => {
  const root = initProject();
  const { hooks, sent } = await load(root);
  const s = "ses_race";
  await fire(hooks, "session.created", s);
  writeFileSync(join(root, "shop/domain/order.py"), LEAK);
  const idle = fire(hooks, "session.idle", s);
  const again = fire(hooks, "session.idle", s);
  await say(hooks, s, "Never mind, leave it.");
  await Promise.all([idle, again]);
  expect(sent).toEqual([]);
});

test("subagents share their session, also when resumed after a restart", async () => {
  const root = initProject();
  const { hooks, sent, parents } = await load(root);
  const [top, child, resumed] = ["ses_top", "ses_child", "ses_resumed"];
  await fire(hooks, "session.created", top);
  await fire(hooks, "session.created", child, top);
  parents.set(resumed, child); // known to OpenCode, never created in this process
  const order = join(root, "shop/domain/order.py");
  writeFileSync(order, LEAK);
  const out = { output: "" };
  await hooks["tool.execute.after"](
    { tool: "write", sessionID: resumed, args: { filePath: order } },
    out,
  );
  expect(out.output).toContain("INW001");
  await say(hooks, child, "Do the subtask.");
  await fire(hooks, "session.idle", child);
  await fire(hooks, "session.idle", resumed);
  expect(sent).toEqual([]);
  await fire(hooks, "session.idle", top);
  expect(sent.map((m) => m.id)).toEqual([top]);
});

test("the Stop gate reports a plugin removed, or rewritten with the marker kept", async () => {
  const root = initProject();
  const path = join(root, PLUGIN);
  const original = readFileSync(path, "utf8");
  const { hooks, sent } = await load(root);
  const s = "ses_gone";
  await fire(hooks, "session.created", s);
  writeFileSync(path, `${PLUGIN_MARKER}\nexport const Inwards = async () => ({});\n`);
  await fire(hooks, "session.idle", s);
  expect(sent.at(-1)?.text).toContain("changed since OpenCode loaded it");

  await say(hooks, s, "Go on.");
  rmSync(path);
  await fire(hooks, "session.idle", s);
  expect(sent.at(-1)?.text).toContain("--agent opencode");

  await say(hooks, s, "Go on.");
  writeFileSync(path, original);
  await fire(hooks, "session.idle", s);
  expect(sent).toHaveLength(2);
});

test("a failed request is tried again: a lookup isn't cached, and an unsent gate message doesn't hold the next idle", async () => {
  const root = initProject();
  const { hooks, sent, parents } = await load(root, root, { get: 3, prompt: 1 });
  const [top, child] = ["ses_retry", "ses_retry_child"];
  await fire(hooks, "session.created", top);
  parents.set(child, top);
  writeFileSync(join(root, "shop/domain/order.py"), LEAK);
  await fire(hooks, "session.idle", child); // the lookup fails: not treated as a top-level session for good
  await fire(hooks, "session.idle", top); // the prompt fails
  expect(sent).toEqual([]);
  await fire(hooks, "session.idle", child);
  await fire(hooks, "session.idle", top);
  expect(sent.map((m) => m.id)).toEqual([top]);
});

test("idles queued behind one that sent the gate's message send nothing more", async () => {
  const root = initProject();
  const { hooks, sent } = await load(root);
  const s = "ses_dupes";
  await fire(hooks, "session.created", s);
  writeFileSync(join(root, "shop/domain/order.py"), LEAK);
  await Promise.all([fire(hooks, "session.idle", s), fire(hooks, "session.idle", s)]);
  expect(sent).toHaveLength(1);
});

test("a gate message that couldn't be sent doesn't use up an attempt", async () => {
  const root = initProject();
  const config = join(root, "pyproject.toml");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace(
      "[tool.inwards]\n",
      "[tool.inwards]\nescalate-after = 1\n",
    ),
  );
  const { hooks, sent } = await load(root, root, { prompt: 1 });
  const s = "ses_unsent";
  await fire(hooks, "session.created", s);
  writeFileSync(join(root, "shop/domain/order.py"), LEAK);
  await fire(hooks, "session.idle", s); // blocks, but the message fails
  await fire(hooks, "session.idle", s); // blocks again: the agent never got the first
  expect(sent.map((m) => [m.noReply, m.text.startsWith(STOP)])).toEqual([[false, true]]);
});

test("a gate message that fails later is sent again, without running the gate again", async () => {
  const root = initProject();
  const config = join(root, "pyproject.toml");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace(
      "[tool.inwards]\n",
      "[tool.inwards]\nescalate-after = 2\n",
    ),
  );
  const { hooks, sent } = await load(root, root, { promptAt: [1] });
  const s = "ses_resend";
  await fire(hooks, "session.created", s);
  writeFileSync(join(root, "shop/domain/order.py"), LEAK);
  await fire(hooks, "session.idle", s); // attempt 1, sent
  await say(hooks, s, sent[0]?.text ?? "");
  await fire(hooks, "session.idle", s); // attempt 2, the message fails
  await fire(hooks, "session.idle", s); // the same message again, not a third attempt
  expect(sent.map((m) => [m.noReply, m.text.startsWith(STOP)])).toEqual([
    [false, true],
    [false, true],
  ]);
});

test("an idle of a newer turn is kept while the gate still answers the older one", async () => {
  const root = initProject();
  const { hooks, sent } = await load(root);
  const s = "ses_turns";
  await fire(hooks, "session.created", s);
  writeFileSync(join(root, "shop/domain/order.py"), LEAK);
  const older = fire(hooks, "session.idle", s);
  await say(hooks, s, "Also rename the class.");
  const newer = fire(hooks, "session.idle", s);
  await Promise.all([older, newer]);
  expect(sent).toHaveLength(1);
});
