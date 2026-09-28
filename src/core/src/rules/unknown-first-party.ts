/**
 * @file INW010 unknown-first-party: an import of a first-party module that doesn't
 * exist, the typical agent hallucination (`from shop.domain.pricing import
 * DiscountPolicy` with no `pricing`), and a relative import that climbs above
 * the top-level package. Existence is decided by probing the disk
 * (`ProjectIndex.ownerOf`), never by the module listing, which misses
 * namespace packages and differs between adapters. The package the missing
 * module would live in is read once (`ProjectIndex.listDir`): it holds any
 * compiled extension of that name, and the names the fix suggests. A module
 * a build step writes (`generated`) passes even when it isn't on disk, since
 * a fresh checkout lacks it.
 */

import { DEFAULT_GENERATED, isGenerated } from "../config/generated.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../contracts/records.ts";
import type { ProjectIndex } from "../lookup/project-index.ts";
import { diagnostic, RULES } from "../meta/registry.ts";
import { packageOf } from "../python/module-names.ts";
import { distance } from "./shared/edit-distance.ts";

/** How many real modules the fix suggests. */
const SUGGESTIONS = 3;
/** What follows a module's name in a file Python imports without a `.py`: an extension (`.so`, `.cpython-313-x86_64-linux-gnu.so`, `.pyd`), Cython source, or bytecode. */
const OTHER_MODULE = /^(?:\.[\w-]+)?\.(?:so|pyd)$|^\.(?:pyx|pyc)$/u;
/** A Python source or stub file name, and its module name. */
const SOURCE = /^(?<name>[^.]+)\.pyi?$/u;

/**
 * INW010's findings, and the imports whose module isn't under the config
 * root: those it reports, and those another portion of a namespace package
 * holds. INW006 leaves both alone, since neither is a package to put in a layer.
 */
interface Unknown {
  found: Diagnostic[];
  missing: ReadonlySet<ImportRef>;
}

/**
 * Applies INW010 to a file's static imports. The module part of each import
 * (`X` in `from X import name`, the whole target otherwise) must exist when
 * a prefix of it is a first-party module: `shop.domain.pricing` is flagged
 * when `shop.domain` exists and `pricing` doesn't. `from X import name` only
 * checks `X`, since `name` may be defined in `X`'s `__init__.py`. An import
 * whose top-level package isn't first-party is third-party and passes, and so
 * does one under a package that extends its `__path__`. A relative import
 * that climbs above the top-level package (an empty target, see `ImportRef`)
 * is always flagged: Python raises on it. A missing module that a
 * `generated` pattern covers passes, and so reaches INW006 like one that exists.
 * A module under an implicit namespace package that another portion of it
 * holds passes too, such as one in another uv workspace member's `src` (#57)
 * or the project's virtualenv (#161), and so does one directly inside a
 * namespace package the config lists in `namespace-packages` (#161); neither
 * reaches INW006, since its code isn't under the config root.
 *
 * @param file - the file the imports come from.
 * @param imports - its static imports.
 * @param project - the module index.
 * @param names - what the config says about modules that aren't on disk.
 * @param names.generated - the `generated` patterns; `DEFAULT_GENERATED` when not set.
 * @param names.namespacePackages - the `namespace-packages` list; none when not set.
 * @returns one error per missing module, and the imports whose module isn't under the config root.
 */
export function checkUnknownImports(
  file: SourceFile,
  imports: readonly ImportRef[],
  project: ProjectIndex,
  names: { generated?: readonly string[]; namespacePackages?: readonly string[] } = {},
): Unknown {
  const { generated = DEFAULT_GENERATED, namespacePackages = [] } = names;
  const found: Diagnostic[] = [];
  const missing = new Set<ImportRef>();
  for (const ref of imports) {
    const module = ref.from ?? ref.target;
    const owner = module === "" ? undefined : project.ownerOf(module);
    let finding: Diagnostic | undefined;
    if (module === "") {
      finding = climbing(file, ref);
    } else if (
      owner !== undefined &&
      owner !== module &&
      project.inOtherPortion(module, owner, namespacePackages)
    ) {
      missing.add(ref);
    } else if (
      owner !== undefined &&
      owner !== module &&
      !project.extendsPath(owner) &&
      !isGenerated(module, generated)
    ) {
      finding = absent(file, ref, owner, project);
    }
    if (finding) {
      found.push(finding);
      missing.add(ref);
    }
  }
  return { found, missing };
}

/**
 * Words a relative import that climbs above the top-level package.
 *
 * @param file - the importing file.
 * @param ref - the import, with an empty target.
 * @returns the error.
 */
function climbing(file: SourceFile, ref: ImportRef): Diagnostic {
  const top = file.module.split(".")[0] ?? file.module;
  return diagnostic(RULES.INW010, file, {
    span: ref,
    message: `\`${ref.statement}\` climbs above the top-level package "${top}", so Python raises ImportError.`,
    fix: {
      summary: "Use fewer dots, or an absolute import from the module that defines the name.",
      steps: [
        `One dot means "${packageOf(file).join(".")}" and each extra dot climbs one package; "${top}" is as far as a relative import reaches.`,
        `If the module is outside "${top}", import it by its absolute name.`,
      ],
    },
  });
}

/**
 * Words an import of a first-party module that doesn't exist, unless the
 * owner package holds a compiled extension or other importable file of that name.
 *
 * @param file - the importing file.
 * @param ref - the import.
 * @param owner - the longest existing prefix of its module part, which is shorter.
 * @param project - the module index.
 * @returns the error, or undefined when the module exists after all.
 */
function absent(
  file: SourceFile,
  ref: ImportRef,
  owner: string,
  project: ProjectIndex,
): Diagnostic | undefined {
  const module = ref.from ?? ref.target;
  const missing = module.slice(owner.length + 1).split(".")[0] ?? module;
  const entries = project.listDir(owner.replaceAll(".", "/")) ?? [];
  if (
    entries.some(
      (e) =>
        !e.dir &&
        e.name.startsWith(`${missing}.`) &&
        OTHER_MODULE.test(e.name.slice(missing.length)),
    )
  ) {
    return undefined;
  }
  const near = suggestions(file, project, { owner, missing, entries });
  return diagnostic(RULES.INW010, file, {
    span: ref,
    message: `"${module}" is not a module of this project: "${owner}" has no "${missing}".`,
    fix: {
      summary: `Import a module that exists, or create "${module}" first.`,
      steps: [
        ...(near.length > 0
          ? [
              `Check the name. The closest modules in "${owner}": ${near.map((m) => `\`${m}\``).join(", ")}.`,
            ]
          : []),
        `If the code isn't written yet, create "${module}" before importing it.`,
        "Don't wrap the import in try/except ImportError; Inwards checks those too.",
      ],
    },
  });
}

/**
 * Picks the members of the owner package closest to a missing name, by edit
 * distance. Never the missing name itself (a dangling `x.py` link lists but
 * doesn't import), the importing file or its own package, hidden or dunder
 * names, or a directory with no Python file in it (`static/`, `templates/`),
 * which is read only when it would make the list.
 *
 * @param file - the importing file.
 * @param project - the module index, to look inside candidate directories.
 * @param where - where the missing module would have been.
 * @param where.owner - the package the missing module would live in.
 * @param where.missing - the missing member's name.
 * @param where.entries - the package's directory listing.
 * @returns up to `SUGGESTIONS` dotted names, closest first, ties in name order.
 */
function suggestions(
  file: SourceFile,
  project: ProjectIndex,
  where: { owner: string; missing: string; entries: readonly { name: string; dir: boolean }[] },
): string[] {
  const { owner, missing, entries } = where;
  const own = new Set([file.module, packageOf(file).join(".")]);
  const members = new Map<string, boolean>();
  for (const { name, dir } of entries) {
    const member = dir ? name : SOURCE.exec(name)?.groups?.["name"];
    const skip =
      member === undefined ||
      member === missing ||
      member.startsWith(".") ||
      member.startsWith("__");
    if (!(skip || own.has(`${owner}.${member}`))) {
      members.set(member, dir || (members.get(member) ?? false));
    }
  }
  const ranked = [...members]
    .map(([member, dir]) => ({ member, dir, d: distance(missing, member) }))
    .sort((a, b) => a.d - b.d || a.member.localeCompare(b.member));
  const near: string[] = [];
  for (const { member, dir } of ranked) {
    if (near.length === SUGGESTIONS) {
      break;
    }
    const path = `${owner}.${member}`.replaceAll(".", "/");
    if (!dir || project.listDir(path)?.some((e) => SOURCE.test(e.name))) {
      near.push(`${owner}.${member}`);
    }
  }
  return near;
}
