/**
 * @file The `fastapi` preset of `inwards init --style`: the
 * fastapi-best-practices layout, with every domain package layered by one
 * template on a kernel of shared modules, and the FastAPI rules, INW012
 * (endpoints hand their work to the domain's service) and INW013 (no
 * blocking call in an `async def`) turned on as warnings. The template also
 * turns INW016 on for every domain's models and denies `fastapi` and
 * `starlette` to the roles below the router's (INW005).
 * It also words the Ruff config that init prints beside the
 * preset and never writes. Pure data; the example's modules are
 * `fastapi.ts`'s.
 */
import { fastapiModules } from "./fastapi.ts";
import { contextsWhy, type Style } from "./styles.ts";

export const FASTAPI: Style = {
  name: "fastapi",
  summary:
    "fastapi-best-practices: one package per domain on a kernel of shared modules, with the FastAPI rules on",
  layers: [
    {
      name: "kernel",
      module: "",
      role: "the shared modules: settings, the base model, exceptions, the database",
      denyLibraries: [],
    },
    {
      name: "domain",
      module: "*",
      role: "every domain package, layered by the fastapi-domain template",
      template: "fastapi-domain",
    },
    { name: "main", module: "main", role: "the app: includes each domain's router", file: true },
  ],
  templates: [
    {
      name: "fastapi-domain",
      why: 'The layers inside every domain, innermost first ("a | b" are siblings), and the modules other code may import; main.py includes each router.',
      roles: [
        { name: "constants", role: "the domain's constants and error codes", file: true },
        {
          name: "exceptions",
          role: "the domain's errors",
          file: true,
          sibling: true,
        },
        { name: "config", role: "the domain's settings", file: true, sibling: true },
        { name: "models", role: "the stored records", file: true },
        {
          name: "schemas",
          role: "what the endpoints take and return",
          file: true,
          sibling: true,
        },
        { name: "utils", role: "helpers with no business logic", file: true },
        { name: "service", role: "business logic", file: true },
        { name: "dependencies", role: "checks the endpoints share", file: true },
        { name: "router", role: "the endpoints", file: true },
      ],
      public: ["router", "service", "schemas", "dependencies", "constants", "exceptions"],
      rules: {
        why: "fastapi-best-practices' table and column names in every domain's models (INW016), as a warning to start with.",
        roles: { models: { "orm-naming": "warning" } },
      },
      deny: {
        why: "The business logic and what it uses don't import the web framework: raise the domain's exceptions, and leave HTTP to the router and dependencies (INW005).",
        roles: ["models", "schemas", "utils", "service"],
        libraries: ["fastapi", "starlette"],
      },
    },
  ],
  contexts: {
    template: "fastapi-domain",
    parent: "",
    why: contextsWhy(
      "domain",
      "Each domain is a context: other domains and main.py may import only its public modules.",
    ),
    names: ["posts"],
  },
  ignoreRules: {
    codes: ["INW002"],
    why: "Domains may use each other's public modules without declaring it; INW003 keeps them to those.",
  },
  optIn: {
    codes: [
      "FAPI001",
      "FAPI002",
      "FAPI003",
      "FAPI005",
      "FAPI006",
      "FAPI007",
      "FAPI008",
      "FAPI009",
      "INW012",
      "INW013",
    ],
    why: "The FastAPI rules, thin endpoints (INW012) and no blocking calls in async def (INW013), as warnings to start with: make them errors once the project is clean.",
    options: [
      {
        rule: "undocumented-error-response",
        why: "Leave raises in the endpoint itself to Ruff's FAST004.",
        lines: ["report-direct-raises = false"],
      },
      {
        rule: "thin-endpoint",
        why: "An endpoint hands its work to its domain's service module.",
        lines: ['delegate-to = ["domain.service"]'],
      },
    ],
  },
  companion: ruffCompanion,
  example: fastapiModules,
  tryIt: (pkg: string): string =>
    `uv add fastapi uvicorn pydantic-settings && uv run uvicorn ${pkg}.main:app`,
  shapes: [
    {
      package: "",
      require: ["main.py"],
      allow: [
        "*/",
        "config.py",
        "database.py",
        "exceptions.py",
        "models.py",
        "pagination.py",
        "__main__.py",
        "_version.py",
      ],
      extra: "error",
      why: "domain packages, the kernel's shared modules and the app only; anything else is an error",
    },
    {
      package: "*",
      require: ["__init__", "router", "service"],
      allow: ["constants", "exceptions", "config", "models", "schemas", "utils", "dependencies"],
      extra: "error",
      why: "the domain's roles only; any other module would fall to the kernel layer",
    },
  ],
  gap: "a router may use the models directly instead of going through the service",
};

/**
 * Words the Ruff config that goes with the preset: the rules that check one
 * file at a time, and the ban on subclassing pydantic's base classes outside
 * the base module and `config.py`.
 *
 * @param base - the package's path relative to the project, e.g. `src/app`.
 * @returns the text init prints; it never writes it into the Ruff config.
 */
function ruffCompanion(base: string): string {
  return `Ruff checks what one file shows. Add this to pyproject.toml to go with the preset (init doesn't change your Ruff config):

[tool.ruff.lint]
extend-select = ["ASYNC", "FAST", "TID251"]

[tool.ruff.lint.flake8-tidy-imports.banned-api]
"pydantic.BaseModel".msg = "Subclass CustomModel from ${base}/models.py instead."
"pydantic_settings.BaseSettings".msg = "Subclass BaseSettings only in a config.py module."

[tool.ruff.lint.per-file-ignores]
"${base}/models.py" = ["TID251"]
"**/config.py" = ["TID251"]`;
}
