/**
 * @file Loaded before every test file (bunfig.toml `[test] preload`). A hook
 * registered here is global, so it runs once, after the last file: see
 * `temp.ts` for why the temporary directories are removed from here.
 * Importing `temp.ts` also points `XDG_STATE_HOME` at a temporary directory
 * before any test file loads, so the session start witnesses the tests
 * record (#88) never land in the developer's own `~/.local/state`.
 */
import { afterAll } from "bun:test";
import { removeTempDirs } from "./temp.ts";

// Generous: removing every test's temporary tree takes more than the default
// 5 s on the Windows runner, which reported it as a timed-out hook.
afterAll(removeTempDirs, 60_000);
