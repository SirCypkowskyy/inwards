/**
 * @file Lists the source folders that need a fallow zone. `shared/` is a folder
 * of folders, so each of its subfolders counts, not `shared` itself.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Lists the subfolders of a folder.
 *
 * @param src - `src/cli/src`.
 * @param dir - a folder below it ("" for `src` itself).
 * @returns their paths relative to `src`.
 */
function subfolders(src: string, dir: string): string[] {
  return readdirSync(join(src, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name));
}

/**
 * Lists the folders of the CLI's source that each need a zone.
 *
 * @param src - `src/cli/src`.
 * @returns paths relative to `src`, `shared/platform` for a subfolder of `shared`.
 */
export function zonedFolders(src: string): string[] {
  return subfolders(src, "").flatMap((folder) =>
    folder === "shared" ? subfolders(src, folder) : [folder],
  );
}
