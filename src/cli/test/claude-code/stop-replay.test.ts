/**
 * @file The Stop gate against a session record rebuilt through Bash (#88): the
 * start record deleted, rewritten or replayed with a made-up SessionStart, and
 * the Stop hook deleted from the settings. Normal flows (a user's own config
 * edit before the session, resume, compact, /clear) must still pass.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { CLAUDE_USER_DIR, CMD, inwards, payload, type RunResult } from "../support/run.ts";
import { agentWrites, git, ID, LEAK, session, stop } from "../support/stop-helpers.ts";
import { STATE_HOME } from "../support/temp.ts";

/** The infrastructure layer's line in the test config. */
const INFRA_LAYER = /\n.*shop\.infrastructure.*\n/u;

/**
 * Loosens the project's config: without the infrastructure layer, the domain
 * may import it.
 *
 * @param root - the project directory.
 * @returns the loosened pyproject.toml text, also written to the project.
 */
function loosen(root: string): string {
  const path = join(root, "pyproject.toml");
  const text = readFileSync(path, "utf8").replace(INFRA_LAYER, "\n");
  writeFileSync(path, text);
  return text;
}

/**
 * Runs a shell script in a project the way an agent's Bash tool would, with
 * `$I` holding the command that starts Inwards.
 *
 * @param root - the project directory.
 * @param script - the shell script.
 * @param env - extra variables.
 * @returns the exit code and output.
 */
function bash(root: string, script: string, env: Record<string, string> = {}): RunResult {
  const p = Bun.spawnSync(["sh", "-c", script], {
    cwd: root,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => name !== "CLAUDE_PROJECT_DIR"),
      ),
      CLAUDE_CONFIG_DIR: CLAUDE_USER_DIR,
      I: CMD.join(" "),
      ...env,
    },
  });
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

/**
 * Sends a SessionStart for the test session.
 *
 * @param root - the project directory.
 * @param source - startup, clear, resume or compact.
 * @param id - which session, the test session unless another is named.
 * @returns the exit code and output.
 */
function sessionStart(root: string, source: string, id = ID): RunResult {
  return inwards(["hook", "claude-code"], {
    cwd: root,
    stdin: payload("session-start", root, { session_id: id, source }),
  });
}

/**
 * Names a session's start witness outside the project.
 *
 * @param root - the project directory.
 * @param id - which session, the test session unless another is named.
 * @returns the witness file's path.
 */
function witness(root: string, id = ID): string {
  const key = createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 32);
  return join(STATE_HOME, "inwards", "sessions", key, `${id}.start.json`);
}

/** Whether this git has `--no-lazy-fetch` (2.44 and later), which the committed-config read needs. */
const NO_LAZY_FETCH = Bun.spawnSync(["git", "--no-lazy-fetch", "version"]).exitCode === 0;

/**
 * Runs `inwards hook claude-code` with extra environment variables.
 *
 * @param env - the variables, e.g. an `XDG_STATE_HOME` to use.
 * @param root - the project directory.
 * @param stdin - the payload text.
 * @returns the exit code and output.
 */
function hookWith(env: Record<string, string>, root: string, stdin: string): RunResult {
  return inwards(["hook", "claude-code"], { cwd: root, stdin, env });
}

describe("Stop gate: a session record rebuilt through Bash (#88)", () => {
  test("the issue's repro: sed, rm of the state, a replayed SessionStart, then Stop", () => {
    const root = session();
    agentWrites(root, "shop/domain/order.py", LEAK);
    const replay = bash(
      root,
      `sed -i.bak '/shop.infrastructure/d' pyproject.toml
d=.inw; rm -rf \${d}ards/state
printf '%s' "$P" | $I hook claude-code`,
      { P: payload("session-start", root, { session_id: ID, source: "startup" }) },
    );
    expect(replay.code).toBe(0);
    expect(readFileSync(join(root, "pyproject.toml"), "utf8")).not.toContain("infrastructure");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("A SessionStart for this session arrived after it had started");
    expect(stderr).toContain("[tool.inwards] changed during this session");
    expect(stderr).toContain("INW001");
  });

  test("the escalation still ends the turn with the replay shown to the user", () => {
    const root = session();
    loosen(root);
    rmSync(join(root, ".inwards/state"), { recursive: true });
    sessionStart(root, "startup");
    for (const active of [false, true, true]) {
      expect(stop(root, { stop_hook_active: active }).code).toBe(2);
    }
    const ended = stop(root, { stop_hook_active: true });
    expect(ended.code).toBe(0);
    expect(JSON.parse(ended.stdout).systemMessage).toContain("arrived after it had started");
  });

  test("a partial replay, deleting only the start file, is caught the same way", () => {
    const root = session();
    loosen(root);
    rmSync(join(root, ".inwards/state", `${ID}.start.json`));
    sessionStart(root, "clear");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("arrived after it had started");
    expect(stderr).toContain("[tool.inwards] changed during this session");
  });

  test("a replay keeps the original start, so a violation written before it still blocks", () => {
    const root = session();
    agentWrites(root, "shop/domain/order.py", LEAK);
    rmSync(join(root, ".inwards/state"), { recursive: true });
    sessionStart(root, "startup");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain('"code":"INW001"');
  });

  test("a start record deleted without a replay is checked against the witness", () => {
    const root = session();
    loosen(root);
    rmSync(join(root, ".inwards"), { recursive: true });
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("is missing from .inwards/state");
    expect(stderr).toContain("[tool.inwards] changed during this session");
  });

  test("a start record rewritten with the loosened config is caught", () => {
    const root = session();
    loosen(root);
    const path = join(root, ".inwards/state", `${ID}.start.json`);
    const start = JSON.parse(readFileSync(path, "utf8"));
    const forged = inwards(["hook", "claude-code"], {
      cwd: root,
      stdin: payload("session-start", root, { session_id: "forger", source: "startup" }),
    });
    expect(forged.code).toBe(0);
    const loose = JSON.parse(readFileSync(join(root, ".inwards/state/forger.start.json"), "utf8"));
    writeFileSync(path, JSON.stringify({ ...start, configs: loose.configs }));
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("was rewritten in .inwards/state");
    expect(stderr).toContain("[tool.inwards] changed during this session");
  });

  test("without a witness, a start config that isn't the committed one fails the gate", () => {
    const root = session();
    loosen(root);
    rmSync(join(root, ".inwards/state"), { recursive: true });
    rmSync(witness(root));
    sessionStart(root, "startup"); // a fresh record and witness: this replay isn't caught
    rmSync(witness(root)); // but one that loses its witness is
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("no copy of this session's start record outside the project");
    expect(stderr).toContain("pyproject.toml");
  });

  test("without a witness, a start config that is the committed one passes", () => {
    const root = session();
    git(root, "commit", "-qam", "init"); // what init added to pyproject.toml
    sessionStart(root, "startup", "committed");
    rmSync(witness(root, "committed"));
    const run = inwards(["hook", "claude-code"], {
      cwd: root,
      stdin: payload("stop", root, { session_id: "committed" }),
    });
    // git before 2.44 has no --no-lazy-fetch, so there the committed config can't be read.
    // Also on git before 2.44: this repository is no partial clone, so nothing can be fetched.
    expect(run).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("without a witness, a partial clone on git before 2.44 is reported as unverifiable", () => {
    const root = session();
    git(root, "commit", "-qam", "init");
    git(root, "config", "remote.origin.promisor", "true");
    sessionStart(root, "startup", "partial");
    rmSync(witness(root, "partial"));
    const run = inwards(["hook", "claude-code"], {
      cwd: root,
      stdin: payload("stop", root, { session_id: "partial" }),
    });
    // git 2.44 and later read the blob with --no-lazy-fetch, partial clone or not.
    const unverifiable = "can't read the committed [tool.inwards] without fetching";
    expect(run.code).toBe(NO_LAZY_FETCH ? 0 : 2);
    expect(run.stderr.includes(unverifiable)).toBe(!NO_LAZY_FETCH);
    expect(run.stderr).not.toContain("was not the committed one");
  });

  test("a flood of made-up sessions can't evict the real session's witness before a replay", () => {
    const root = session();
    const flood = bash(
      root,
      `for i in $(seq 1 55); do printf '%s' "$P" | sed "s/flood-id/flood-$i/" | $I hook claude-code; done`,
      { P: payload("session-start", root, { session_id: "flood-id", source: "startup" }) },
    );
    expect(flood.code).toBe(0);
    expect(existsSync(witness(root))).toBe(true);
    loosen(root);
    rmSync(join(root, ".inwards/state"), { recursive: true });
    sessionStart(root, "startup");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("arrived after it had started");
  }, 180_000);

  test("a running session's witness doesn't age out", () => {
    const root = session();
    const week = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    utimesSync(witness(root), week, week);
    expect(stop(root).code).toBe(0); // the Stop marks it as in use
    sessionStart(root, "startup", "later"); // prunes witnesses older than a week
    expect(existsSync(witness(root))).toBe(true);
  });

  test("a user's uncommitted config edit made before the session passes", () => {
    const root = session();
    loosen(root); // the user's edit, not committed
    sessionStart(root, "startup", "user-session");
    const run = inwards(["hook", "claude-code"], {
      cwd: root,
      stdin: payload("stop", root, { session_id: "user-session" }),
    });
    expect(run).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("resume, compact and /clear leave a clean session clean", () => {
    const root = session();
    expect(sessionStart(root, "compact").code).toBe(0);
    expect(sessionStart(root, "resume").code).toBe(0);
    expect(stop(root)).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(sessionStart(root, "clear", "after-clear").code).toBe(0);
    const next = inwards(["hook", "claude-code"], {
      cwd: root,
      stdin: payload("stop", root, { session_id: "after-clear" }),
    });
    expect(next).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("a repeated startup, with the record in place, changes nothing", () => {
    const root = session();
    expect(sessionStart(root, "startup").stdout).toBe("");
    expect(stop(root)).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("an unwritable state home doesn't fail SessionStart; Stop falls back to the committed config", () => {
    const root = session();
    git(root, "commit", "-qam", "init"); // what init added, so only the agent's edit is uncommitted
    const env = { XDG_STATE_HOME: join(root, "pyproject.toml", "not-a-dir") };
    const started = hookWith(
      env,
      root,
      payload("session-start", root, { session_id: "ro", source: "startup" }),
    );
    expect(started.code).toBe(0);
    expect(JSON.parse(started.stdout).systemMessage).toContain("couldn't keep a copy");
    const clean = hookWith(env, root, payload("stop", root, { session_id: "ro" }));
    expect(clean.code).toBe(0); // the committed config
    loosen(root); // the agent, through Bash, with no witness to catch a replay
    rmSync(join(root, ".inwards/state/ro.start.json"));
    hookWith(env, root, payload("session-start", root, { session_id: "ro", source: "startup" }));
    const { code, stderr } = hookWith(env, root, payload("stop", root, { session_id: "ro" }));
    expect(code).toBe(2);
    expect(stderr).toContain("no copy of this session's start record outside the project");
  });

  test("without any record, the last Stop tells the user", () => {
    const root = session();
    rmSync(join(root, ".inwards"), { recursive: true });
    rmSync(witness(root));
    expect(stop(root).code).toBe(2);
    const ended = stop(root, { stop_hook_active: true });
    expect(ended.code).toBe(0);
    expect(JSON.parse(ended.stdout).systemMessage).toContain(
      "no record of how this session started",
    );
  });
});

describe("SessionStart: a Stop hook deleted through Bash (#88)", () => {
  test("the next session warns the user", () => {
    const root = session();
    bash(
      root,
      `cd .claude && python3 -c '
import json
s = json.load(open("settings.local.json"))
del s["hooks"]["Stop"]
json.dump(s, open("settings.local.json", "w"))
'`,
    );
    const next = sessionStart(root, "startup", "next-session");
    expect(next.code).toBe(0);
    const out = JSON.parse(next.stdout);
    expect(out.systemMessage).toContain("Stop hook is missing");
    expect(out.hookSpecificOutput.additionalContext).toContain("Stop hook is missing");
  });

  test("with every hook in place it says nothing", () => {
    const root = session();
    expect(sessionStart(root, "startup", "next-session").stdout).toBe("");
  });
});
