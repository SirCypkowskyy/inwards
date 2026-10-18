/**
 * @file Gives the engine's config/, diagram/, baseline/ and report/ folders a
 * public `index.ts` (ADR-047, #424). Renames each other module to `_name.ts`
 * (through `move-slice.ts`, so imports inside the folder follow), repoint every
 * import from outside the folder at the folder's `index.ts` (merged per file),
 * and write the index from the names those imports use. Tests keep importing
 * the private modules they probe. It is idempotent: rerun it after a rebase conflict.
 *
 * Usage: `bun run scripts/engine-indexes-424.ts`.
 */
// biome-ignore-all lint: one-shot migration script, rerun after a rebase, not product code
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "src/core/src");
const FOLDERS = ["config", "diagram", "baseline", "report"];
/** An import or re-export with a braced name list, comments aside. */
const STATEMENT =
  /^(?<kind>import|export)(?<type> type)?\s*\{(?<names>[^}]*)\}\s*from\s*"(?<spec>\.{1,2}\/[^"]+)";\n/gmu;

/**
 * Lists every TypeScript file below a directory.
 *
 * @param dir - an absolute directory.
 * @returns absolute file paths.
 */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return files(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Tells which engine folder a private module belongs to.
 *
 * @param path - an absolute module path.
 * @returns the folder name, or `undefined` outside the four.
 */
function folderOf(path: string): string | undefined {
  return FOLDERS.find((folder) => dirname(path) === join(SRC, folder));
}

/** One imported name: whether it is a type and the exported (left) name. */
type Names = Map<string, boolean>;

/**
 * Moves every plain module of the four folders to `_name.ts`.
 *
 * @throws {Error} when `move-slice.ts` fails.
 */
function renameModules(): void {
  const moves = FOLDERS.flatMap((folder) =>
    readdirSync(join(SRC, folder))
      .filter((name) => name.endsWith(".ts") && name !== "index.ts" && !name.startsWith("_"))
      .map((name) => `src/core/src/${folder}/${name}=src/core/src/${folder}/_${name}`),
  );
  if (moves.length > 0) {
    const run = Bun.spawnSync(["bun", "run", "scripts/move-slice.ts", ...moves], { cwd: ROOT });
    if (run.exitCode !== 0) {
      throw new Error(run.stderr.toString());
    }
  }
}

/**
 * Repoints one file's imports of the private modules at the folder indexes.
 *
 * @param file - an absolute path under `src/core/src`.
 * @param used - collects the names each folder's index must export.
 * @returns whether the file changed.
 */
function repoint(file: string, used: Map<string, Names>): boolean {
  const text = readFileSync(file, "utf8");
  const seen = new Map<string, { names: Names; kind: string }>();
  const next = text.replace(STATEMENT, (match, ...args) => {
    const { kind, type, names, spec } = args.at(-1) as Record<string, string | undefined>;
    const target = resolve(dirname(file), spec ?? "");
    const folder = folderOf(target);
    if (!folder || folderOf(file) === folder || !/\/(_[^/]+|index)\.ts$/u.test(target)) {
      return match;
    }
    const key = `${kind} ${folder}`;
    const entry = seen.get(key) ?? { names: new Map(), kind: kind ?? "import" };
    for (const raw of (names ?? "").split(",")) {
      const part = raw.trim();
      if (part === "") {
        continue;
      }
      const isType = Boolean(type) || part.startsWith("type ");
      const bare = part.replace(/^type\s+/u, "");
      entry.names.set(bare, (entry.names.get(bare) ?? true) && isType);
      const exported = bare.split(/\s+as\s+/u)[0] as string;
      const all = used.get(folder) ?? new Map();
      all.set(exported, (all.get(exported) ?? true) && isType);
      used.set(folder, all);
    }
    const first = !seen.has(key);
    seen.set(key, entry);
    return first ? `@@${key}@@\n` : "";
  });
  const merged = next.replace(/@@(?<key>[^@]+)@@\n/gu, (_m, key: string) => {
    const entry = seen.get(key) as { names: Names; kind: string };
    const [, folder] = key.split(" ") as [string, string];
    const spec = relative(dirname(file), join(SRC, folder, "index.ts"));
    const list = [...entry.names].sort(([a], [b]) => a.localeCompare(b));
    const allTypes = list.every(([, isType]) => isType);
    const body = list.map(([name, isType]) => (isType && !allTypes ? `type ${name}` : name));
    return `${entry.kind}${allTypes ? " type" : ""} { ${body.join(", ")} } from "${spec.startsWith(".") ? spec : `./${spec}`}";\n`;
  });
  if (merged !== text) {
    writeFileSync(file, merged);
  }
  return merged !== text;
}

/**
 * Writes a folder's `index.ts`, one re-export per private module.
 *
 * @param folder - the folder name.
 * @param used - the names outside importers use.
 */
function writeIndex(folder: string, used: Names): void {
  const owners = new Map<string, Names>();
  for (const module of readdirSync(join(SRC, folder)).filter((n) => n.startsWith("_"))) {
    const text = readFileSync(join(SRC, folder, module), "utf8");
    for (const [name, isType] of used) {
      const bare = name.replace(/^type\s+/u, "");
      const declared = new RegExp(
        `^export\\s+(?:declare\\s+)?(?:async\\s+)?(?:const|function\\*?|class|interface|type|enum)\\s+${bare}\\b`,
        "mu",
      );
      if (
        declared.test(text) ||
        new RegExp(`^export\\s+(?:type\\s+)?\\{[^}]*\\b${bare}\\b`, "mu").test(text)
      ) {
        const bucket = owners.get(module) ?? new Map();
        bucket.set(bare, isType);
        owners.set(module, bucket);
      }
    }
  }
  const lines = [...owners]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, names]) => {
      const list = [...names].sort(([a], [b]) => a.localeCompare(b));
      const allTypes = list.every(([, isType]) => isType);
      const body = list.map(([name, isType]) => (isType && !allTypes ? `type ${name}` : name));
      return `export${allTypes ? " type" : ""} { ${body.join(", ")} } from "./${module}";`;
    });
  writeFileSync(
    join(SRC, folder, "index.ts"),
    `/**\n * @file The public face of the ${folder}/ slice. Everything outside the folder\n * imports this module, never a private \`_x.ts\` behind it.\n */\n${lines.join("\n")}\n`,
  );
}

renameModules();
const used = new Map<string, Names>();
for (const file of files(SRC)) {
  if (repoint(file, used)) {
    console.log(`rewrote ${relative(ROOT, file)}`);
  }
}
for (const folder of FOLDERS) {
  writeIndex(folder, used.get(folder) ?? new Map());
  if (!existsSync(join(SRC, folder, "index.ts"))) {
    process.exit(1);
  }
}
