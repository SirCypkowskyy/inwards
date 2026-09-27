/**
 * @file The second half of the OpenCode plugin's source (ADR-033): the
 * plugin itself, which turns OpenCode's events and tool calls into Claude
 * Code hook payloads, keeps each session's Stop gate state, and maps
 * subagent sessions to the session they work for. `opencode.ts` puts the
 * file together; this is JavaScript text, not code this module runs.
 */

/** The exported plugin; it needs the helpers in `PLUGIN_HELPERS` above it. */
export const PLUGIN_HOOKS = `export const Inwards = async ({ client, directory }) => {
  /**
   * What the plugin knows about each top-level session: whether the Stop gate
   * sent it back to work (and its message hasn't arrived yet), how many messages the user sent (a Stop result from
   * before the latest one is stale), whether a turn is running, the agent and
   * model the user picked, and the queue that keeps its Stop checks in order.
   */
  const sessions = new Map();
  /** A subagent's session, by the top-level session it works for. */
  const parents = new Map();
  const state = (id) => {
    if (!sessions.has(id)) {
      sessions.set(id, {
        continued: false,
        awaiting: false,
        generation: 0,
        busy: false,
        started: false,
        chosen: {},
        queue: Promise.resolve(),
      });
    }
    return sessions.get(id);
  };

  /**
   * Finds the top-level session a session works for. A subagent's session
   * created before OpenCode started is looked up once.
   *
   * @param id - any session id.
   * @returns the id of its top-level session.
   */
  const root = async (id) => {
    if (parents.has(id)) {
      return parents.get(id);
    }
    if (sessions.has(id)) {
      return id;
    }
    try {
      const parentID = (await client.session.get({ path: { id } }))?.data?.parentID;
      if (parentID) {
        const top = await root(parentID);
        parents.set(id, top);
        return top;
      }
    } catch {
      return id; // unknown for now: ask again next time
    }
    state(id);
    return id;
  };

  /**
   * Records how a top-level session starts, once; a session OpenCode resumed
   * gets a resume, which only logs itself.
   *
   * @param id - a top-level session.
   * @param source - "startup" for a new session, "resume" otherwise.
   */
  const start = async (id, source) => {
    const s = state(id);
    if (s.started) {
      return;
    }
    s.started = true;
    const result = await hook({ session_id: id, hook_event_name: "SessionStart", source });
    const context = output(result.stdout).hookSpecificOutput?.additionalContext;
    if (context) {
      await note(id, context);
    }
  };

  /**
   * Adds a message to a session for the model and the user to read, without starting a turn.
   *
   * @param id - the session.
   * @param text - what to say.
   */
  const note = async (id, text) => {
    await client.session.promptAsync({
      path: { id },
      body: { ...state(id).chosen, noReply: true, parts: [{ type: "text", text: NOTE_PREFACE + text }] },
    });
  };

  /**
   * Runs the Stop gate for a top-level session that went idle. OpenCode can't
   * refuse the end of a turn, so a block starts another one with the gate's
   * reasons, as the agent the user picked.
   *
   * @param id - the session.
   * @param generation - the user's message count when the session went idle.
   */
  const stop = async (id, generation) => {
    const s = state(id);
    if (s.awaiting || generation !== s.generation) {
      return; // an idle from before the gate's last message, or the user's, arrived
    }
    const result = await hook({ session_id: id, hook_event_name: "Stop", stop_hook_active: s.continued });
    if (generation !== s.generation || s.busy || s.awaiting) {
      return; // the user or the agent moved on while the gate ran
    }
    if (result.code === 2) {
      s.continued = true;
      s.awaiting = true;
      try {
        await client.session.promptAsync({
          path: { id },
          body: { ...s.chosen, parts: [{ type: "text", text: STOP_PREFACE + result.stderr }] },
        });
      } catch {
        s.awaiting = false; // not sent: the next idle runs the gate again
      }
      return;
    }
    s.continued = false;
    const message = broken(result)
      ? \`the Stop gate couldn't run: \${result.stderr.trim()}\`
      : output(result.stdout).systemMessage;
    if (message) {
      await note(id, message);
    }
  };

  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        const { id, parentID } = event.properties.info;
        if (parentID) {
          parents.set(id, await root(parentID));
          return;
        }
        await start(id, "startup");
      } else if (event.type === "session.status") {
        const id = event.properties.sessionID;
        if (sessions.has(id)) {
          state(id).busy = event.properties.status?.type === "busy";
        }
      } else if (event.type === "session.idle") {
        const id = event.properties.sessionID;
        // Before anything waits: a message the user sends after this idle makes it stale.
        const seen = sessions.get(id)?.generation;
        if ((await root(id)) !== id) {
          return; // a subagent: the gate runs for the session it works for
        }
        await start(id, "resume");
        const s = state(id);
        s.busy = false;
        const generation = seen ?? s.generation;
        s.queue = s.queue.then(() => stop(id, generation)).catch(() => undefined);
        await s.queue;
      }
    },
    "chat.message": async (input, out) => {
      const id = await root(input.sessionID);
      if (id !== input.sessionID) {
        return; // a prompt to a subagent is part of its parent's turn
      }
      const s = state(id);
      const own = ownMessage(out?.parts);
      if (own === "stop") {
        s.awaiting = false; // the gate's message arrived: the continued turn begins
      }
      if (own) {
        return;
      }
      // A message the user sends starts a new turn, with the agent and model they picked.
      s.generation += 1;
      s.continued = false;
      s.awaiting = false;
      s.chosen = {
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.model ? { model: input.model } : {}),
      };
    },
    "tool.execute.before": async (input, out) => {
      const session = await root(input.sessionID);
      if (input.tool === "apply_patch") {
        const guarded = patchedFiles(out.args?.patchText, directory).filter(
          (p) => names(PROTECTED, p) || names(CONFIG, p),
        );
        if (guarded.length > 0) {
          throw new Error(
            \`Inwards: apply_patch may not change \${guarded.join(", ")}; use the edit tool, which the config guard checks, or ask the user.\`,
          );
        }
        return;
      }
      const name = TOOLS[input.tool];
      if (name === undefined) {
        return;
      }
      const tool_input = toolInput(input.tool, out.args ?? {}, directory);
      if (name !== "Bash" && names(PROTECTED, tool_input.file_path)) {
        throw new Error(\`Inwards: \${tool_input.file_path} is Inwards' own; ask the user to change it.\`);
      }
      const result = await hook({ session_id: session, hook_event_name: "PreToolUse", tool_name: name, tool_input });
      const reason = denial(result.stdout);
      if (reason !== undefined) {
        throw new Error(reason);
      }
      if (broken(result) && touchesRules(input.tool, tool_input)) {
        throw new Error(
          \`Inwards couldn't check this call (\${result.stderr.trim()}), so it may not touch the config or Inwards' files. Ask the user to run \\\`inwards init --agent opencode\\\`.\`,
        );
      }
    },
    "tool.execute.after": async (input, out) => {
      const session = await root(input.sessionID);
      const files =
        input.tool === "apply_patch"
          ? patchedFiles(input.args?.patchText, directory)
          : input.tool === "edit" || input.tool === "write"
            ? [toolInput(input.tool, input.args ?? {}, directory).file_path]
            : [];
      for (const file_path of files) {
        const result = await hook({
          session_id: session,
          hook_event_name: "PostToolUse",
          tool_name: input.tool === "write" ? "Write" : "Edit",
          tool_input: { file_path },
          tool_response: {},
        });
        const said =
          result.code === 2
            ? result.stderr
            : broken(result)
              ? \`Inwards couldn't check \${file_path}: \${result.stderr.trim()}\`
              : output(result.stdout).hookSpecificOutput?.additionalContext;
        if (said) {
          out.output = \`\${out.output ?? ""}\\n\\n\${said}\`;
        }
      }
    },
  };
};
`;
