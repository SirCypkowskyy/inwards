/**
 * @file `inwards init --style auto`'s mapping: the name table that sorts an
 * existing package's top-level modules into layer roles, the choice of the
 * closest preset (which names and orders the layers), and the
 * `[tool.inwards]` table that writes only the modules that exist, with the
 * ones it couldn't place listed as comments.
 *
 * Pure: the caller lists the package and hands over its members, and
 * writing, checking and asking are `_auto-command.ts`'s.
 */
import { tomlArray } from "./_shapes.ts";
import { CYCLES } from "./_style-text.ts";

/** A layer role the name table knows, innermost first in {@link ROLES}. */
type Role = "kernel" | "domain" | "services" | "adapters" | "presentation" | "entry";

/** One row of the name table: the role, the module names it takes, and what the layer holds. */
interface RoleRow {
  role: Role;
  names: readonly string[];
  what: string;
}

/**
 * The name table, documented in the install guide ("On an existing
 * codebase"): a top-level module or package of the project's package goes to
 * the role whose row names it. Anything else is left out and listed.
 */
export const NAME_TABLE: readonly RoleRow[] = [
  {
    role: "kernel",
    names: [
      "core",
      "db",
      "database",
      "config",
      "settings",
      "kernel",
      "shared",
      "common",
      "utils",
      "helpers",
    ],
    what: "settings, the database and helpers every layer may use; any library",
  },
  {
    role: "domain",
    names: ["models", "entities", "domain", "schemas"],
    what: "entities, models and schemas",
  },
  {
    role: "services",
    names: ["crud", "services", "service", "use_cases", "usecases", "application"],
    what: "business operations: CRUD functions, services, use cases",
  },
  {
    role: "adapters",
    names: ["adapters", "infrastructure", "infra", "repositories", "repository", "persistence"],
    what: "repositories and adapters to the outside world",
  },
  {
    role: "presentation",
    names: ["api", "routes", "routers", "router", "views", "endpoints", "presentation", "web"],
    what: "endpoints and views that take requests",
  },
  {
    role: "entry",
    names: ["main", "bootstrap", "__main__", "asgi", "wsgi"],
    what: "the composition root: builds the app and wires the layers",
  },
];

/** Tooling the config ignores instead of layering: Alembic's migration environment. */
const TOOLING: readonly string[] = ["alembic"];

/** The closest presets: they decide where the adapters go and what each layer is called. */
export type AutoPreset = "layered" | "clean" | "hexagonal";

/** Each preset's layers innermost first, as role and layer name. */
const ORDER: Readonly<Record<AutoPreset, readonly (readonly [Role, string])[]>> = {
  layered: [
    ["kernel", "kernel"],
    ["domain", "domain"],
    ["adapters", "persistence"],
    ["services", "services"],
    ["presentation", "presentation"],
    ["entry", "bootstrap"],
  ],
  clean: [
    ["kernel", "kernel"],
    ["domain", "domain"],
    ["services", "application"],
    ["adapters", "infrastructure"],
    ["presentation", "presentation"],
    ["entry", "bootstrap"],
  ],
  hexagonal: [
    ["kernel", "kernel"],
    ["domain", "domain"],
    ["services", "application"],
    ["adapters", "adapters"],
    ["presentation", "presentation"],
    ["entry", "bootstrap"],
  ],
};

/** Names that make the clean preset the closest: entities and use cases inside, infrastructure outside. */
const CLEAN_NAMES: ReadonlySet<string> = new Set([
  "domain",
  "entities",
  "application",
  "use_cases",
  "usecases",
  "infrastructure",
  "infra",
]);

/** A top-level member of the package: a subpackage or a module. */
export interface Member {
  name: string;
  package: boolean;
}

/** One layer of the proposal: its name, what it holds, and its modules below the package. */
export interface AutoLayer {
  name: string;
  what: string;
  /** Module names below the package, e.g. `core` or `crud`. */
  modules: string[];
  /** True for the kernel: it holds the settings and the database, so INW005's default for the innermost layer is lifted. */
  anyLibrary: boolean;
}

/** What `--style auto` proposes for one package. */
export interface Proposal {
  preset: AutoPreset;
  /** The layers innermost first; only roles some member took. */
  layers: AutoLayer[];
  /** Members no row of the name table names, sorted. */
  unmapped: Member[];
  /** Tooling members the config ignores, e.g. `alembic`. */
  tooling: string[];
}

/**
 * Maps a package's top-level members to layers by the name table, and picks
 * the closest preset: hexagonal when there is an `adapters` package, clean
 * when a name only clean architecture uses is there (`domain`,
 * `application`, `infrastructure`...), layered otherwise. The preset decides
 * whether adapters sit below the services (layered: services call
 * persistence) or above them (clean, hexagonal: adapters implement ports).
 *
 * @param members - the package's subpackages and modules, without `__init__`
 *   and without what the config ignores (tests, scripts, migrations).
 * @returns the layers that hold at least one member, the members left over,
 *   and the tooling (`alembic`) the config should ignore.
 */
export function propose(members: readonly Member[]): Proposal {
  const names = new Set(members.map((member) => member.name));
  const preset = presetFor(names);
  const byRole = new Map<Role, string[]>();
  const unmapped: Member[] = [];
  const tooling: string[] = [];
  for (const member of [...members].sort((a, b) => a.name.localeCompare(b.name))) {
    if (TOOLING.includes(member.name)) {
      tooling.push(member.name);
      continue;
    }
    const row = NAME_TABLE.find((r) => r.names.includes(member.name));
    if (row === undefined) {
      unmapped.push(member);
      continue;
    }
    byRole.set(row.role, [...(byRole.get(row.role) ?? []), member.name]);
  }
  const layers = ORDER[preset].flatMap(([role, name]) => {
    const modules = byRole.get(role);
    const row = NAME_TABLE.find((r) => r.role === role);
    return modules === undefined || row === undefined
      ? []
      : [{ name, what: row.what, modules, anyLibrary: role === "kernel" }];
  });
  return { preset, layers, unmapped, tooling };
}

/**
 * Picks the closest preset from the names the package holds.
 *
 * @param names - the package's top-level member names.
 * @returns hexagonal, clean or layered.
 */
function presetFor(names: ReadonlySet<string>): AutoPreset {
  if (names.has("adapters")) {
    return "hexagonal";
  }
  return [...names].some((name) => CLEAN_NAMES.has(name)) ? "clean" : "layered";
}

/**
 * Builds the `[tool.inwards]` table for a proposal: a header naming the
 * closest preset, one layer entry per mapped role with what it holds as a
 * comment (the kernel with `deny-libraries = []`, since settings and the
 * database need libraries), module and context cycles turned on as the
 * presets do, the tooling added to `ignore`, and the unmapped
 * members as comments to move into a layer by hand.
 *
 * @param proposal - the mapped layers and the leftovers.
 * @param opts - the package, the config root, this release, the ignore list and the line ending.
 * @param opts.pkg - the project's import package, e.g. `app`.
 * @param opts.root - the config root, `src` or `.`.
 * @param opts.version - this release, for `required-version` and the comment.
 * @param opts.ignore - the `ignore` entries.
 * @param opts.eol - the file's line ending.
 * @returns the table's text, ending with a line break.
 */
export function autoTable(
  proposal: Proposal,
  opts: { pkg: string; root: string; version: string; ignore: readonly string[]; eol: string },
): string {
  const { pkg } = opts;
  const rows = proposal.layers.map((layer) => {
    const modules = tomlArray(layer.modules.map((module) => `${pkg}.${module}`));
    const deny = layer.anyLibrary ? ", deny-libraries = []" : "";
    return [`  { name = ${JSON.stringify(layer.name)}, modules = ${modules}${deny} },`, layer.what];
  });
  const width = Math.max(...rows.map(([entry]) => (entry ?? "").length));
  const left =
    proposal.unmapped.length === 0
      ? []
      : [
          "# In no layer, so no layer rule checks them; add each to the layer it belongs in:",
          ...proposal.unmapped.map(
            (member) => `#   "${pkg}.${member.name}"${member.package ? "  (package)" : ""}`,
          ),
        ];
  const lines = [
    "[tool.inwards]",
    `# Mapped from ${pkg}'s modules by inwards init --style auto (Inwards ${opts.version}); closest preset: ${proposal.preset}.`,
    "# Layers are listed innermost first: each may import itself and the layers above it.",
    "# A module the name table put in the wrong layer can move to another one.",
    `root = ${JSON.stringify(opts.root)}`,
    `required-version = ${JSON.stringify(opts.version)}`,
    `ignore = ${tomlArray([...opts.ignore, ...proposal.tooling])}`,
    ...CYCLES,
    "layers = [",
    ...rows.map(([entry, what]) => `${(entry ?? "").padEnd(width)}  # ${what ?? ""}`),
    "]",
    ...left,
  ];
  return `${lines.join(opts.eol)}${opts.eol}`;
}

/**
 * Describes the mapping for people, one line per layer and one for the
 * leftovers, as init prints it beside the table.
 *
 * @param proposal - the mapped layers and the leftovers.
 * @param pkg - the project's import package.
 * @returns e.g. `  kernel        app.core` lines, innermost first.
 */
export function describeProposal(proposal: Proposal, pkg: string): string {
  const width = Math.max(...proposal.layers.map((layer) => layer.name.length), "(no layer)".length);
  const lines = proposal.layers.map(
    (layer) =>
      `  ${layer.name.padEnd(width)}  ${layer.modules.map((m) => `${pkg}.${m}`).join(", ")}`,
  );
  if (proposal.unmapped.length > 0) {
    const left = proposal.unmapped.map((member) => `${pkg}.${member.name}`).join(", ");
    lines.push(`  ${"(no layer)".padEnd(width)}  ${left}`);
  }
  return lines.join("\n");
}
