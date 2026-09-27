/**
 * What the CLI's commands are given: everything the hook handlers get, plus
 * the storage only some commands write (the baseline, the export). `main.ts`
 * builds one `AppDeps` per invocation from the adapters; commands never
 * import an adapter themselves.
 */
import type { HookDeps } from "../claude-code/protocol.ts";
import type { InitDeps } from "../init/contracts.ts";
import type { BaselineWriter } from "../project/contracts.ts";
import type { ExportFiles } from "../runlog/contracts.ts";

/** One invocation's dependencies. */
export interface AppDeps extends HookDeps {
  /** Replaces `inwards-baseline.json`. */
  baselines: BaselineWriter;
  /** Keeps the export key and writes the export. */
  exports: ExportFiles;
  /** What `inwards init` needs besides the platform. */
  init: InitDeps;
}
