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

afterAll(removeTempDirs);
