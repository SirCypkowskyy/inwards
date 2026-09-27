/**
 * @file Writing `inwards-baseline.json`, behind the `BaselineWriter` contract. A
 * temporary file and a rename replace a planted symlink instead of writing
 * through it; a path that can't be replaced (a directory) is a config error.
 */
import { renameSync, rmSync, writeFileSync } from "node:fs";
import process from "node:process";
import { ConfigError } from "@inwards/core";
import type { BaselineWriter } from "../project/contracts.ts";

/** Baseline replacement on the real filesystem. */
export const nodeBaselineWriter: BaselineWriter = {
  replace(path: string, text: string): void {
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, text, { flag: "wx" });
    try {
      renameSync(temp, path);
    } catch (err) {
      rmSync(temp, { force: true });
      throw new ConfigError(`can't write ${path}; is it a directory?`, { cause: err });
    }
  },
};
