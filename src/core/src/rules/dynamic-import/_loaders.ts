/**
 * @file The table of calls INW011 treats as module loaders, by fully qualified
 * name, with how each one names what it loads. `callees.ts` resolves local
 * names to these, `loader-targets.ts` and `calls.ts` read their arguments.
 */

/**
 * How a loading call names what it loads: a module name and package
 * (`import_module`, `find_spec`), `__import__`'s arguments, `run_module`'s
 * name, a `pkgutil.resolve_name` spec, a file path (`file`), or source code.
 */
export type LoaderKind =
  | "import_module"
  | "__import__"
  | "run_module"
  | "resolve_name"
  | "file"
  | "source";

/** Every call INW011 reads, by fully qualified name. */
export const LOADERS: ReadonlyMap<string, LoaderKind> = new Map<string, LoaderKind>([
  ["importlib.import_module", "import_module"],
  ["importlib.util.find_spec", "import_module"],
  ["importlib.util.spec_from_file_location", "file"],
  ["importlib.machinery.SourceFileLoader", "file"],
  ["pkgutil.resolve_name", "resolve_name"],
  ["importlib.__import__", "__import__"],
  ["builtins.__import__", "__import__"],
  ["runpy.run_module", "run_module"],
  ["builtins.exec", "source"],
  ["builtins.eval", "source"],
  ["builtins.compile", "source"],
]);

/** `functools.partial`, which binds a loader's arguments ahead of the call. */
export const PARTIAL = "functools.partial";
