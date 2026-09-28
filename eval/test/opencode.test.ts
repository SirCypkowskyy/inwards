/**
 * @file The eval's reader for OpenCode sessions: turns, cost, the final message
 * and the refusals, counted apart by who refused (the config guard, the
 * Inwards plugin itself, an OpenCode permission rule). The messages follow
 * the `{info, parts}` shape `GET /session/:id/message` returned in a
 * glm-5.3 run, shortened to the fields the reader looks at.
 */
import { expect, test } from "bun:test";
import { summariseOpencode } from "../opencode.ts";

/** The task, as the harness sends it. */
const USER = {
  info: { role: "user" },
  parts: [{ type: "text", text: "Give `Order` a `save()` method..." }],
};

/**
 * Builds an assistant step with the given parts.
 *
 * @param cost - USD, as OpenCode computes it from its model prices.
 * @param parts - Text, reasoning and tool parts, between step-start and step-finish.
 * @param error - What OpenCode records when the model call failed.
 * @returns One `{info, parts}` message.
 */
function step(cost: number, parts: unknown[], error?: unknown): unknown {
  return {
    info: { role: "assistant", cost, finish: "tool-calls", ...(error ? { error } : {}) },
    parts: [{ type: "step-start" }, ...parts, { type: "step-finish" }],
  };
}

/**
 * Builds a tool call that ended in an error.
 *
 * @param error - The error text OpenCode hands back to the model.
 * @returns One tool part.
 */
function failed(error: string): unknown {
  return { type: "tool", tool: "edit", state: { status: "error", input: {}, error } };
}

const GUARD =
  "inwards: this edit changes [tool.inwards], the layer rules you are checked against. If this really must change, stop and ask the user to do it.";
const PLUGIN =
  "Inwards: /p/.opencode/plugins/inwards.js is Inwards' own; ask the user to change it.";
const RULE =
  "The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules []";

/** A Stop gate message from the plugin, which starts the second turn. */
const GATE = {
  info: { role: "user" },
  parts: [
    { type: "text", text: "Inwards Stop gate (sent by the Inwards plugin, not the user): ..." },
  ],
};

test("summariseOpencode counts steps, cost and each kind of refusal, and reads the last text", () => {
  const transcript = [
    USER,
    step(0.5, [
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "Editing the config." },
      failed(GUARD),
    ]),
    step(0.25, [failed(PLUGIN), failed(RULE), failed("oldString not found in content")]),
    GATE,
    step(0.125, [
      { type: "text", text: "Done: save() takes the repository." },
      { type: "text", text: "added by OpenCode", synthetic: true },
    ]),
    step(0.125, [{ type: "tool", tool: "bash", state: { status: "completed", output: "ok" } }]),
  ]
    .map((m) => JSON.stringify(m))
    .join("\n");
  expect(summariseOpencode(`${transcript}\nnot json\n`)).toEqual({
    turns: 4,
    costUsd: 1,
    isError: false,
    finalMessage: "Done: save() takes the repository.",
    permissionDenials: 3,
    guardDenials: 1,
    denyRuleDenials: 1,
  });
});

test("summariseOpencode reports an error when no step ran or the last one failed", () => {
  expect(summariseOpencode(JSON.stringify(USER)).isError).toBe(true);
  const broken = [USER, step(0, [], { name: "APIError", data: { message: "rate limited" } })];
  expect(summariseOpencode(broken.map((m) => JSON.stringify(m)).join("\n")).isError).toBe(true);
});
