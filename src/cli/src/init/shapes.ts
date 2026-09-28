/**
 * @file The package shapes (INW007, INW008) the `inwards init --style` presets
 * write with `--scaffold`, and their text in the config table and in
 * `--list-styles`. Each shape fits the scaffold's packages; no I/O, and which
 * preset uses which shape is `styles.ts`'s business.
 */

/**
 * One `[[tool.inwards.shape]]` a preset writes with `--scaffold`. Packages that
 * only hold layers get `extra = "error"`: a member there belongs to no layer,
 * so no layer rule would check it. A layer with a known inner layout only
 * warns about extra members, so normal growth never blocks an edit.
 */
export interface StyleShape {
  /** Dotted package below the project package; "" is the package itself. */
  package: string;
  require: readonly string[];
  allow: readonly string[];
  extra: "error" | "warning";
  /** What the shape keeps in place, for the table's comment and `--list-styles`. */
  why: string;
}

/**
 * The package's own shape: its layer packages and the composition root.
 *
 * @param layers - the top-level layer packages, with a trailing `/`.
 * @returns the shape, `__main__.py` allowed so `python -m` keeps working.
 */
export function topShape(layers: readonly string[]): StyleShape {
  return {
    package: "",
    require: [...layers, "bootstrap.py"],
    allow: ["__main__.py"],
    extra: "error",
    why: "the layers and the composition root only; anything else is an error, since no layer would hold it",
  };
}

export const USE_CASES: StyleShape = {
  package: "application",
  require: ["ports/", "use_cases/"],
  allow: [],
  extra: "warning",
  why: "ports and use cases; anything else is a warning",
};

export const ADAPTERS: StyleShape = {
  package: "adapters",
  require: ["inbound/", "outbound/"],
  allow: [],
  extra: "error",
  why: "the inbound and outbound layers only; anything else is an error, since no layer would hold it",
};

/**
 * Lists a preset's shapes for `inwards init --list-styles`, one line each.
 *
 * @param shapes - the preset's shapes.
 * @param pkg - the package name to show.
 * @returns e.g. `    shop.application  requires ports/, use_cases/: ports and use cases; ...`.
 */
export function describeShapes(shapes: readonly StyleShape[], pkg: string): string[] {
  const width = Math.max(...shapes.map((shape) => shapePackage(pkg, shape).length));
  return shapes.map((shape) => {
    const allow = shape.allow.length === 0 ? "" : `; allows ${shape.allow.join(", ")}`;
    return `    ${shapePackage(pkg, shape).padEnd(width)}  requires ${shape.require.join(", ")}${allow}: ${shape.why}`;
  });
}

/**
 * Names the package a shape selects.
 *
 * @param pkg - the project's import package.
 * @param shape - one of the preset's shapes.
 * @returns the dotted package, e.g. `my_app.application`.
 */
function shapePackage(pkg: string, shape: StyleShape): string {
  return shape.package === "" ? pkg : `${pkg}.${shape.package}`;
}

/**
 * Writes one TOML array of strings.
 *
 * @param values - the strings.
 * @returns e.g. `["ports/", "use_cases/"]`.
 */
function array(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

/**
 * Writes a preset's `[[tool.inwards.shape]]` entries, each after a blank line
 * and a comment saying what it keeps in place.
 *
 * @param shapes - the preset's shapes.
 * @param pkg - the project's import package.
 * @returns the lines, without line endings.
 */
export function shapeLines(shapes: readonly StyleShape[], pkg: string): string[] {
  return shapes.flatMap((shape, i) => [
    "",
    ...(i === 0 ? ["# Package shapes (INW007, INW008) for the scaffold's packages."] : []),
    `# ${shapePackage(pkg, shape)}: ${shape.why}.`,
    "[[tool.inwards.shape]]",
    `packages = ${array([shapePackage(pkg, shape)])}`,
    `require = ${array(shape.require)}`,
    `allow = ${array(shape.allow)}`,
    ...(shape.extra === "warning" ? ['extra = "warning"'] : []),
  ]);
}
