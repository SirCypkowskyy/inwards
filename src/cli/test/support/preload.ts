/**
 * @file Loaded before every test file (bunfig.toml `[test] preload`). A hook
 * registered here is global, so it runs once, after the last file: see
 * `temp.ts` for why the temporary directories are removed from here.
 */
import { afterAll } from "bun:test";
import { removeTempDirs } from "./temp.ts";

afterAll(removeTempDirs);
