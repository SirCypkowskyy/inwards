/**
 * @file The second half of the OpenCode plugin's source (ADR-033): the
 * plugin itself, which turns OpenCode's events and tool calls into Claude
 * Code hook payloads, keeps each session's Stop gate state, and maps
 * subagent sessions to the session they work for. `opencode.ts` puts the
 * file together; this is JavaScript text, not code this module runs.
 */

/** The exported plugin; it needs the helpers in `PLUGIN_HELPERS` above it. */
export const PLUGIN_HOOKS = `/** How many times a session lookup is tried before the session counts as unknown for now. */
const LOOKUPS = 3;

export const Inwards = async ({ client, directory }) => {
  /**
   * What the plugin knows about each top-level session:
   * - whether the Stop gate sent it back to work, whether that message is still
   *   on its way or couldn't be sent, and which turn the gate is answering;
   * - how many messages the user sent, and how many idles came: only the
   *   latest idle, from after the user's latest message, runs the gate;
   * - whether a turn is running;
   * - the agent, model and variant the user picked;
   * - how it started, and the queue that runs its Stop checks one at a time.
   */
  const sessions = new Map();
  /** A subagent's session, by the top-level session it works for. */
  const parents = new Map();
  const state = (id) => {
    if (!sessions.has(id)) {
      sessions.set(id, {
        continued: false,
        awaiting: false,
        running: undefined,
        unsent: undefined,
        generation: 0,
        idles: 0,
        busy: false,
        starting: undefined,
        chosen: {},
        queue: Promise.resolve(),
      });
    }
    return sessions.get(id);
  };

  /**
   * Sends a message into a session. The SDK reports a failed request in its
   * result rather than throwing, so both count as not sent.
   *
   * @param id - the session.
   * @param body - the prompt body, without the session's chosen agent and model.
   * @returns true when the request was accepted.
   */
  const send = async (id, body) => {
    try {
      const result = await client.session.promptAsync({ path: { id }, body: { ...state(id).chosen, ...body } });
      return !result?.error;
    } catch {
      return false;
    }
  };

  /**
   * Finds the top-level session a session works for. A subagent's session
   * created before OpenCode started is looked up; a failed lookup is tried again next time.
   *
   * @param id - any session id.
   * @returns the id of its top-level session, or undefined while a lookup fails.
   */
  const root = async (id) => {
    if (parents.has(id)) {
      return parents.get(id);
    }
    if (sessions.has(id)) {
      return id;
    }
    let found;
    for (let attempt = 0; attempt < LOOKUPS && !found; attempt += 1) {
      try {
        const answer = await client.session.get({ path: { id } });
        found = answer?.error ? undefined : answer?.data;
      } catch {
        found = undefined;
      }
    }
    if (!found) {
      return undefined;
    }
    const parentID = found.parentID;
    if (parentID) {
      const top = await root(parentID);
      if (top !== undefined) {
        parents.set(id, top);
      }
      return top;
    }
    state(id);
    return id;
  };

  /**
   * Records how a top-level session starts, once; every hook of the session
   * waits for it. A session OpenCode resumed gets a resume, which only logs itself.
   *
   * @param id - a top-level session.
   * @param source - "startup" for a new session, "resume" otherwise.
   * @returns when the record is written.
   */
  const start = (id, source) => {
    const s = state(id);
    s.starting ??= (async () => {
      const result = await hook({ session_id: id, hook_event_name: "SessionStart", source });
      const context = output(result.stdout).hookSpecificOutput?.additionalContext;
      if (context) {
        await note(id, context);
      }
    })();
    return s.starting;
  };

  /**
   * Adds a message to a session for the model and the user to read, without
   * starting a turn. A turn that is running may still read it.
   *
   * @param id - the session.
   * @param text - what to say.
   */
  const note = async (id, text) => {
    await send(id, { noReply: true, parts: [{ type: "text", text: NOTE_PREFACE + text }] });
  };

  /**
   * Tells whether an idle still stands: the latest one, after the user's
   * latest message, with no turn running and no message from the gate on its way.
   *
   * @param s - the session's state.
   * @param idle - what the idle saw: its number and the user's message count.
   * @returns true when the gate may run, or act on its result.
   */
  const current = (s, idle) =>
    idle.number === s.idles && idle.generation === s.generation && !s.busy && !s.awaiting;

  /**
   * Runs the Stop gate for a top-level session that went idle. OpenCode can't
   * refuse the end of a turn, so a block starts another one with the gate's
   * reasons, as the agent the user picked.
   *
   * @param id - the session.
   * @param idle - the idle's number and the user's message count when it came.
   */
  const stop = async (id, idle) => {
    const s = state(id);
    if (!current(s, idle)) {
      return; // a later idle, a message or a turn made this one stale
    }
    s.running = idle.generation;
    try {
      await answer(id, s, idle);
    } finally {
      s.running = undefined;
    }
  };

  /**
   * Runs the gate for an idle that stands and passes on what it says. A gate
   * message that couldn't be sent is sent again instead: the gate already
   * counted that attempt.
   *
   * @param id - the session.
   * @param s - its state.
   * @param idle - the idle's number and the user's message count when it came.
   */
  const answer = async (id, s, idle) => {
    if (s.unsent !== undefined) {
      await deliver(id, s, s.unsent);
      return;
    }
    const result = await hook({ session_id: id, hook_event_name: "Stop", stop_hook_active: s.continued });
    // The gate has counted this attempt, so a later idle doesn't make the result stale;
    // a message from the user, or a turn that started, does.
    if (idle.generation !== s.generation || s.busy || s.awaiting) {
      return;
    }
    if (result.code === 2) {
      s.continued = true;
      await deliver(id, s, STOP_PREFACE + result.stderr);
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

  /**
   * Sends the gate's message, which starts another turn; one that fails is kept for the next idle.
   *
   * @param id - the session.
   * @param s - its state.
   * @param text - the message.
   */
  const deliver = async (id, s, text) => {
    const generation = s.generation;
    s.awaiting = true;
    const sent = await send(id, { parts: [{ type: "text", text }] });
    // The user may have moved on while the request ran, and OpenCode may
    // already have taken the message (clearing awaiting): only a failure for
    // this turn changes anything.
    if (!sent && generation === s.generation) {
      s.awaiting = false;
      s.unsent = text;
    } else if (sent) {
      s.unsent = undefined;
    }
  };

  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        const { id, parentID } = event.properties.info;
        if (parentID) {
          const top = await root(parentID);
          if (top !== undefined) {
            parents.set(id, top);
          }
          return;
        }
        await start(id, "startup");
      } else if (event.type === "session.status") {
        const id = event.properties.sessionID;
        if (sessions.has(id)) {
          state(id).busy = event.properties.status?.type === "busy";
        }
      } else if (event.type === "session.error") {
        const id = event.properties.sessionID;
        if (sessions.has(id)) {
          state(id).awaiting = false; // a message that failed after it was accepted
        }
      } else if (event.type === "session.idle") {
        const id = event.properties.sessionID;
        // Before anything waits: later idles and messages make this one stale.
        const known = sessions.get(id);
        if (known !== undefined && known.running === known.generation) {
          return; // the gate is already answering this turn's idle
        }
        const seen = known ? { number: ++known.idles, generation: known.generation } : undefined;
        if (known) {
          known.busy = false; // now, so activity seen while this handler waits isn't overwritten
        }
        if ((await root(id)) !== id) {
          return; // a subagent, or not known yet: the gate runs for the session it works for
        }
        await start(id, "resume");
        const s = state(id);
        const idle = seen ?? { number: ++s.idles, generation: s.generation };
        s.queue = s.queue.then(() => stop(id, idle)).catch(() => undefined);
        await s.queue;
      }
    },
    "chat.message": async (input, out) => {
      const id = await root(input.sessionID);
      if (id !== input.sessionID) {
        return; // a prompt to a subagent is part of its parent's turn; an unknown session waits
      }
      const s = state(id);
      const own = ownMessage(out?.parts);
      if (own === "stop") {
        // The gate's message arrived: the continued turn begins, and idles queued before it are stale.
        s.awaiting = false;
        s.busy = true;
      }
      if (own) {
        return;
      }
      // A message the user sends starts a new turn, with the agent, model and variant they picked.
      s.generation += 1;
      s.continued = false;
      s.awaiting = false;
      s.unsent = undefined;
      s.chosen = {
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.variant ? { variant: input.variant } : {}),
      };
    },
    "tool.execute.before": async (input, out) => {
      const top = await root(input.sessionID);
      if (top !== undefined) {
        await start(top, "resume");
      }
      // While OpenCode can't say whose subagent this is, the call is checked under its own id.
      const session = top ?? input.sessionID;
      if (input.tool === "apply_patch") {
        const guarded = patchedFiles(out.args?.patchText, directory).filter((p) => inwardsOwn(p) || configFile(p));
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
      if (name !== "Bash" && inwardsOwn(tool_input.file_path)) {
        throw new Error(\`Inwards: \${tool_input.file_path} is Inwards' own; ask the user to change it.\`);
      }
      const result = await hook({ session_id: session, hook_event_name: "PreToolUse", tool_name: name, tool_input });
      const reason = denial(result.stdout);
      if (reason !== undefined) {
        throw new Error(reason);
      }
      if (result.code === 2) {
        // As in Claude Code: exit 2 blocks the call, with stderr as the reason.
        throw new Error(result.stderr.trim() || "Inwards refused this call.");
      }
      if (broken(result) && touchesRules(input.tool, tool_input)) {
        throw new Error(
          \`Inwards couldn't check this call (\${result.stderr.trim()}), so it may not touch the config or Inwards' files. Ask the user to run \\\`inwards init --agent opencode\\\`.\`,
        );
      }
    },
    "tool.execute.after": async (input, out) => {
      const top = await root(input.sessionID);
      if (top !== undefined) {
        await start(top, "resume");
      }
      // While OpenCode can't say whose subagent this is, the call is checked under its own id.
      const session = top ?? input.sessionID;
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
