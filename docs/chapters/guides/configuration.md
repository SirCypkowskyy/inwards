# Configuration reference { #configuration-reference }

Inwards reads the `[tool.inwards]` table of the nearest `pyproject.toml`, walking up from the working directory, or the file `--config` names. At a uv workspace root it reads each member's own table instead ([Monorepos and uv workspaces](#monorepos)). This page lists every key: its type, its default, and an example. Chapter 1 shows [a whole config](../01-Introduction.md#what-inwards-does); [ADR-005](../05-ADR.md#adr-005-configuration-lives-in-pyprojecttoml) says why it lives in `pyproject.toml`.

A complete config needs only `layers`:

```toml title="pyproject.toml"
[tool.inwards]
root = "src"
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
```

An unknown key, a wrong type or a bad value is a config error: `inwards check` exits 2 and names the key, such as `tool.inwards.contexts[0].depends-on[1]`. The table is protected like code: the Claude Code config guard denies an agent's edit of any key in it ([chapter 4](../04-AI-Integration.md#stopping-the-agent-from-gaming-the-check)).

## Editor completion and checking { #editor-completion }

A JSON Schema for `[tool.inwards]` is published at <https://sircypkowskyy.github.io/inwards/schema/tool-inwards.json>. That URL follows the `develop` branch, like these docs. To pin the schema to the release you run, use the `inwards-tool-schema.json` file attached to each [GitHub release](https://github.com/SirCypkowskyy/inwards/releases).

Editors that take `pyproject.toml`'s schema from [SchemaStore](https://www.schemastore.org/) will complete and check `[tool.inwards]` with no setup once SchemaStore merges Inwards' schema ([SchemaStore#6427](https://github.com/SchemaStore/schemastore/pull/6427), [#192](https://github.com/SirCypkowskyy/inwards/issues/192)). Until then, set it up by hand.

Editors that use [Taplo](https://taplo.tamasfe.dev/) (Even Better TOML in VS Code, and others) attach schemas to whole files: Taplo ignores a rule's `keys` when it picks the schema, so the table schema alone would be checked against the entire `pyproject.toml`. Use the whole-file schema built from it instead, <https://sircypkowskyy.github.io/inwards/schema/pyproject.json>, which checks `[tool.inwards]` and leaves every other table alone. A `.taplo.toml` next to `pyproject.toml`:

```toml title=".taplo.toml"
[[rule]]
include = ["**/pyproject.toml"]

[rule.schema]
path = "https://sircypkowskyy.github.io/inwards/schema/pyproject.json"
```

This replaces the schema Taplo would otherwise take from SchemaStore for that file, so the other tables go unchecked. Once SchemaStore has Inwards' schema, drop the rule and let SchemaStore's cover the whole file. Releases attach it as `inwards-pyproject-schema.json`.

The schema checks structure: the keys, their types, the allowed values, the rule codes and the shape of names and patterns. Inwards checks more when it reads the config:

- relations between entries: unique layer and context names, a prefix in two layers or two contexts, `public` entries a context owns, `depends-on` names that exist, `template` names that exist, a role listed twice;
- exact module names and selector segments, where the schema accepts a slightly looser form, and glob ranges written backwards, such as `[z-a]`;
- `required-version` against the running binary.

So a config the schema accepts can still be a config error, and the error names the key.

## Keys { #keys }

### `root` { #root }

Type: string. Default: `"."`.

The directory, relative to `pyproject.toml`, that module names are computed from. With `root = "src"`, `src/shop/domain/order.py` is the module `shop.domain.order`.

One config has one root. In a uv workspace whose members each have their own `src/` (`src/packages/core/src/core`), give each member its own `[tool.inwards]`: `inwards check` at the workspace root then checks every member with its own config ([Monorepos and uv workspaces](#monorepos)). A single config at the workspace root would name that package `packages.core.src.core`, and other members' `import core` would pass as a third-party import, so `inwards check` warns about each member it indexes that way ([INW006](../rules/INW006.md)).

### `layers` { #layers }

Type: array of tables, at least one. Required.

The layers, innermost first. A module may import its own layer and any layer listed before it; importing a layer listed after it is INW001. An entry can also be a nested array of [sibling layers](#sibling-layers). Each layer has:

- `name`: a non-empty string, unique among layers.
- `modules`: module prefixes and [selectors](#selectors). A prefix, `shop.domain`, owns `shop.domain` and everything under it, but not `shop.domainx`. When several prefixes match a module, the longest wins, so a nested package can sit in a different layer from its parent. The same entry in two layers is a config error. An empty list is allowed.
- `allow-libraries`, `deny-libraries`, `extend-deny-libraries`: which libraries the layer may import (INW005). The [libraries guide](libraries.md#configure-it) has the details.
- `template`: the name of a [template](#templates) whose roles become layers inside this entry's modules. The entry itself is then no layer.

#### Selectors { #selectors }

An entry with a `*` is a selector. Vertical slices repeat the same layers in every slice; `shop.*.domain` says once what `shop.orders.domain`, `shop.billing.domain` and every later slice would each need as a prefix:

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.*.domain"] },
  { name = "application", modules = ["shop.*.application"] },
  { name = "infrastructure", modules = ["shop.*.infra", "shop.api"] },
]
```

- **Grammar.** `*` matches exactly one segment and `**` one or more, as in [shape selectors](package-shape.md). Every other segment is a package name. A selector owns every module equal to one of its matches, and everything under it: `shop.*.domain` owns `shop.orders.domain` and `shop.orders.domain.order`, but not `shop.orders` or `shop.a.b.domain`.
- **It starts with a package name**: `shop.*.domain`, not `*.domain`. That top-level package is what `inwards check`, the Stop gate and the language server walk in full, skipping nothing but hidden entries, so a `node_modules` or virtualenv directory inside it can't hide layer code. A project with several top-level packages lists one selector per package.
- **Config errors**: a selector with no package name (`*`, `**`, `*.domain`), a partial wildcard (`shop.dom*`), `?`, brackets, empty segments and path separators. An entry without a `*` is a literal prefix and is checked as leniently as before.

When several entries match a module, the most specific wins, in this order:

1. the deepest last literal segment of the match, so `shop.orders.domain` beats `shop.**`, which matches deeper but whose last literal segment is `shop`;
2. then the deeper match;
3. then more literal segments;
4. then the layer listed first.

For literal prefixes alone, this is the longest prefix, as it always was. The truth table, with layers `a` and `b` in that order:

| `a` | `b` | Module | Owner | Matched prefix |
|---|---|---|---|---|
| `shop.domain` | | `shop.domainx` | none | |
| `shop.*.domain` | | `shop.orders.domain.order` | `a` | `shop.orders.domain` |
| `shop.*.domain` | | `shop.a.b.domain` | none: `*` is one segment | |
| `shop.*.domain` | | `shop.orders` | none: a partial match | |
| `shop.*` | | `shop` | none: `*` needs a segment | |
| `shop.**` | | `shop.orders.infra.db` | `a` | `shop.orders.infra.db` |
| `shop.**.domain` | | `shop.a.b.domain.order` | `a` | `shop.a.b.domain` |
| `shop.**.domain` | | `shop.domain` | none: `**` is at least one | |
| `shop.orders.domain` | `shop.**` | `shop.orders.domain.order` | `a`: deeper last literal | `shop.orders.domain` |
| `shop.orders.domain` | `shop.**` | `shop.orders.api` | `b` | `shop.orders.api` |
| `shop.orders.*` | `shop.*.domain` | `shop.orders.domain.order` | `b`: deeper last literal | `shop.orders.domain` |
| `shop.orders.*` | `shop.orders.*.*` | `shop.orders.x.y` | `b`: deeper match | `shop.orders.x.y` |
| `shop.*.domain` | `shop.orders.domain` | `shop.orders.domain.order` | `b`: more literal segments | `shop.orders.domain` |
| `shop.**.domain` | `shop.*.domain` | `shop.orders.domain` | `a`: listed first | `shop.orders.domain` |
| `shop` | `shop.domain` | `shop.domain.order` | `b`: longest prefix | `shop.domain` |

What changes with selectors:

- **Fix steps name the slice.** INW001, INW005 and INW011 tell the agent to declare a port in the importing module's own matched prefix, `shop.billing.domain` for a file in billing, and suggest `shop.billing.domain.ports` only when that prefix is a package. A layer with several literal prefixes gets the same treatment, so its fix now names the prefix the file is in rather than the layer's first.
- **INW006 needs evidence.** A package holds a selector's layer only when the project has a module below it that the selector matches: `shop.*.domain` doesn't make `shop/util.py` part of a layer, and `shop.**.domain` doesn't cover `shop.orders.core.order`. A selector that matches no module is dead, whatever the precedence.
- **Sessions check each slice.** A slice is a matched module's prefix up to the selector's last literal segment: `shop.orders.domain` for `shop.*.domain`, `shop` for `shop.**`. A slice that held modules when the session started and holds none now fails the Stop gate, as a literal prefix does. So renaming or deleting a slice needs the user: `git mv shop/orders shop/sales`, moving a slice deeper under `shop.**.domain`, or deleting a slice whose only module is its `__init__.py`. Deleting or renaming modules inside a slice that keeps others doesn't.

[ADR-034](../05-ADR.md#adr-034-layer-selectors-anchored-in-a-top-level-package-with-slice-aware-session-checks) records the design.

#### Sibling layers { #sibling-layers }

A nested array of two or more layers holds independent siblings, import-linter's `a | b`. They share one place in the order: each may import the layers before the group, the layers after the group may import each of them, and neither may import the other. An import from one sibling into another is INW001, and its message says `from sibling layer`:

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "constants", modules = ["app.constants"] },
  [
    { name = "models", modules = ["app.models"] },
    { name = "schemas", modules = ["app.schemas"] },
  ],
  { name = "service", modules = ["app.service"] },
]
```

Here `app.schemas` may import `app.constants` but not `app.models`, and `app.service` may import both. The allowed direction in messages reads `constants <- models | schemas <- service`. When the innermost place holds siblings, each of them gets INW005's default deny list. A sibling can't name a template, and a group of one layer is a config error. `inwards init --style hexagonal` writes its inbound and outbound adapters as one sibling group ([Install](install.md#a-new-project-start-from-a-preset)).

### `required-version` { #required-version }

Type: string, `"MAJOR.MINOR.PATCH"`. Default: none.

The oldest Inwards allowed to check the project. An older binary fails with a config error instead of checking with rules it may not know. `inwards init` sets it.

### `ignore` { #ignore }

Type: list of module names. Default: none.

Modules left out of the INW006 warning about code outside every layer, such as `tests` or `migrations`. An entry matches whole name segments anywhere in a module name: `migrations` covers `shop.orders.migrations.0001_initial`, and `tests` covers `shop.tests` as well as the top-level `tests`. An entry that starts with `/` matches at the start of the name only: `/tests` covers `tests.test_order` but not `shop.tests.test_order`, which still gets the warning. `inwards init` writes the unanchored defaults. Imports from a layer into ignored modules are still checked.

<!-- config: fragment -->

```toml
[tool.inwards]
ignore = ["/tests", "scripts", "migrations", "conftest"]
```

### `generated` { #generated }

Type: list of module patterns. Default: `["*_pb2", "*_pb2_grpc", "_version"]`.

Modules a build step writes, which INW010 treats as existing when they aren't on disk. Segments may use `*` and `?`; a pattern matches whole segments anywhere in a module name. A list, even an empty one, replaces the default. [ADR-029](../05-ADR.md#adr-029-generated-modules-pass-inw010-protoc-and-version-modules-by-default) has the details.

<!-- config: fragment -->

```toml
[tool.inwards]
generated = ["*_pb2", "*_pb2_grpc", "_version", "shop.api.gen"]
```

### `namespace-packages` { #namespace-packages }

Type: list of package names. Default: none.

Implicit namespace packages (no `__init__.py`) that installed distributions add to. With `namespace-packages = ["acme.platform"]`, [INW010](../rules/INW010.md) doesn't report `import acme.platform.auth.tokens` when the project has only `acme/platform/billing/`: a name directly inside `acme.platform` that isn't in the project comes from a distribution. A made-up `acme.platform.billing.pricing` is still reported, since `billing` is in the project. Inwards finds such modules in the project's `.venv` on its own; the key is for runs without one, such as CI before `uv sync` ([Namespace packages shared with installed distributions](../rules/INW010.md#installed-namespace-packages)).

<!-- config: fragment -->

```toml
[tool.inwards]
namespace-packages = ["acme.platform"]
```

### `escalate-after` { #escalate-after }

Type: whole number, at least 1. Default: `3`.

How many attempts at the same violation before the hooks stop blocking and tell the agent to ask the user.

### `run-log` { #run-log }

Type: boolean. Default: `false`.

Write the opt-in run log `.inwards/runs.jsonl`, which [chapter 8](../08-Run-Log.md) describes.

### `stop-gate` { #stop-gate }

Type: `"changed"` or `"project"`. Default: `"changed"`.

What the Claude Code Stop gate checks: the files the session changed, or the whole project against its baseline, so that a violation in a file the session never touched blocks too.

### `agent-suppressions` { #agent-suppressions }

Type: `"deny"` or `"allow"`. Default: `"deny"`.

Whether the Claude Code hooks honour an inline suppression the agent added during the session. `inwards check` and the language server always honour suppressions. [ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default) has the details.

### `rules` { #rules }

Type: table. Default: every rule reports at its own severity.

Which rules report and how loudly:

- `select`: only these rules report, opt-in rules included. It needs at least one code.
- `extend-select`: these rules report too, next to `select` or the rules that are on by default. It turns [opt-in rules](../rules/index.md#opt-in-rules) on.
- `ignore`: these rules don't report. It wins over `select` and `extend-select`.
- `severity`: a table of rule code to `"error"` or `"warning"`. All four keys take rule codes such as `"INW001"`. A rule name in their place, such as `"layer-dependency"`, is a config error that names the code to write instead.
- `<rule-name>`: a table of that rule's options, such as `[tool.inwards.rules.pure-domain]`. Every rule takes `modules`, a list of module prefixes or selectors written as in a layer's `modules`, which limits the rule to the modules they match. Some rules take their own options too, listed on the rule's page: [`thin-endpoint`](../rules/INW012.md#configuration), [`async-blocking`](../rules/INW013.md#configuration), [`ports-abstract`](../rules/INW014.md#configuration), [`construct-only-in`](../rules/INW015.md#configuration), [`orm-naming`](../rules/INW016.md#configuration), [`endpoint-metadata`](../rules/FAPI001.md#configuration), [`undocumented-error-response`](../rules/FAPI002.md#configuration) and [`router-wiring`](../rules/FAPI003.md#configuration). An unknown key, or one that belongs to another rule, is a config error that names it. The table doesn't turn the rule on, and a table for a rule that is off gets a warning. A [template](#template-rules) can also turn opt-in rules on for one of its roles, which adds to these tables.
- `[tool.inwards.rules.pure-domain]` also takes `deny`, a list of tables with `modules` (prefixes or selectors, as above) and `libraries` (import names, as in a layer's `deny-libraries`). The modules an entry matches may not import its libraries, whether a layer owns them or not, and the layer's `allow-libraries` doesn't undo it ([INW005](../rules/INW005.md), [libraries guide](libraries.md#prefix-deny)). Use it for a package that isn't a whole layer, such as import-linter's "`mypackage.one` must not import `django`".

INW000 can't be ignored, re-levelled or given options. [ADR-027](../05-ADR.md#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table) has the details.

`inwards rules` shows what the table resolves to: every rule with its code, name, whether it is on, its severity, and the key that decided each, as a key under `[tool.inwards]` (`rules.extend-select`, `rules.severity`, `templates.domain.rules.router`), or `default`. A rule limited by `modules` says where (`only in src.*.router`). It reads the nearest config, or `--config FILE`, and without one lists the defaults. `--json` prints the same as `inwards/rules@1`: a `source` and a `severitySource` per rule, each a `kind` (`fixed`, `default`, `opt-in`, `select`, `extend-select`, `template`, `ignore`, `not-selected` or `severity`) and its `keys`. `inwards/rules@1` is a contract, like `inwards/diagnostics@1`: within `@1` fields are only added, and removing or renaming one bumps the version ([ADR-007](../05-ADR.md#adr-007-a-versioned-output-contract-with-fix-steps-as-data)). `inwards rule INW013` prints one rule's page ([MCP guide](mcp.md#explain_rule)).

<!-- config: fragment -->

```toml
[tool.inwards.rules]
ignore = ["INW007", "INW008"]
severity = { INW005 = "warning" }

[tool.inwards.rules.pure-domain]
modules = ["shop"]
deny = [{ modules = ["shop.billing"], libraries = ["django"] }]
```

### `shape` and `names` { #shape }

Type: arrays of tables. Default: none.

Which members a package may, must and must not hold (INW007, INW008), and where a member name may appear. The [package shape guide](package-shape.md) covers both tables and their selector and pattern syntax. A shape entry may also set `hints`, sentences added to the fix steps of its INW007 findings, and `template`, a [template](#templates) that supplies `allow`, `require`, `forbid`, `extra` and `hints`; a key the entry sets itself wins.

### `contexts` { #contexts }

Type: array of tables. Default: none.

Bounded contexts or slices: what each one owns, which of its modules other contexts may import, and which contexts it may depend on. [INW002](../rules/INW002.md) keeps each context to the contexts its `depends-on` lists; [INW003](../rules/INW003.md) keeps code outside a context to its `public` modules.

<!-- config: fragment -->

```toml
[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]
public = ["shop.orders.api"]
depends-on = ["billing"]

[[tool.inwards.contexts]]
name = "billing"
modules = ["shop.billing"]
public = ["shop.billing.api"]
```

Each context has:

- `name`: a non-blank, case-sensitive string, unique among contexts.
- `modules`: module prefixes the context owns, with everything under them. They are literal dotted names; wildcards are a config error. When the prefixes of several contexts match a module, the longest wins, so the order of the tables never matters. The same prefix in two contexts is a config error.
- `public` (default `[]`): prefixes of the context's own modules that the contexts depending on it may import. They are full module names, not relative to the context: `api` means the top-level module `api`. Each one must belong to this context; a prefix another context owns more specifically is a config error. A module is public when it lies at or under a public prefix and this context owns it. An entry written with a leading `=` is exact: `public = ["=shop.billing", "shop.billing.models"]` opens the package facade `shop.billing` (its `__init__`) and `shop.billing.models` with everything under it, but not `shop.billing._invoices` or any other submodule. The module after the `=` is a plain dotted name, and the same ownership rule applies to it.
- `depends-on` (default `[]`): the contexts this one may import from. It is direct: not passed on, and not granted in return. A name may refer to a context declared further down. The context's own name, an unknown name and a repeated name are config errors.
- `template`: a [template](#templates) whose `public` names, under each of the context's `modules`, join its `public` list.

Contexts and layers add up: a declared dependency or a public module never allows an import that the layer order forbids, and belonging to a context says nothing about the layer, or the other way round. A context uses only its own `depends-on` and `public`, even when its prefixes sit inside another context's. [ADR-030](../05-ADR.md#adr-030-bounded-contexts-as-a-contexts-table-of-literal-prefixes) has the reasoning.

### `templates` { #templates }

Type: table of tables, `[tool.inwards.templates.<name>]`. Default: none.

A template says once what a kind of package looks like, when many packages share it: every domain of a FastAPI app, every slice of a modular monolith. Layer, shape and context entries use it with `template = "<name>"`. The [fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices) layout, with its domains `src/orders/` and `src/users/`, as one template:

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "core", modules = ["src.config", "src.database", "src.exceptions", "src.models"], deny-libraries = ["fastapi"] },
  { name = "domain", modules = ["src.*"], template = "fastapi-domain" },
  { name = "app", modules = ["src.main"] },
]

# One template says what every domain package looks like, how its modules
# import each other (innermost first; "a | b" are siblings that may not import
# each other), and which modules other domains may import.
[tool.inwards.templates.fastapi-domain]
roles = [
  "constants | config",
  "exceptions | utils",
  "models | schemas",
  "service",
  "dependencies",
  "router",
]
public = ["router", "service", "dependencies", "schemas", "constants", "exceptions"]
allow = []
require = ["__init__", "router", "service"]
hints = ["Other domains may import this one's router, service, dependencies, schemas, constants and exceptions, never its models, config or utils."]

[[tool.inwards.shape]]
packages = ["src.*"]
template = "fastapi-domain"

[[tool.inwards.contexts]]
name = "orders"
modules = ["src.orders"]
depends-on = ["users"]
template = "fastapi-domain"

[[tool.inwards.contexts]]
name = "users"
modules = ["src.users"]
template = "fastapi-domain"
```

A template has these keys, all optional:

- `roles`: module names relative to a layer entry's modules, innermost first. `"models | schemas"` puts independent [siblings](#sibling-layers) in one place. A role is listed once.
- `public`: module names relative to a context's modules, which other contexts may import ([INW003](../rules/INW003.md)).
- `allow`, `require`, `forbid`, `extra`: as in a [shape entry](package-shape.md#configure-it). When `allow` is set, the first segment of every role is added to it, so `allow = []` means the roles, `require` and `__init__` only.
- `hints`: sentences added to the fix steps of [INW007](../rules/INW007.md) findings in the packages the template shapes, such as where shared code goes.
- `rules`: opt-in rules each role turns on in its modules, such as `router = { async-blocking = true }` ([Rules for a role](#template-rules)).

Where `template = "<name>"` is set, it means:

| On | Expands to |
|---|---|
| a `layers` entry | one layer per role, named `<entry>.<role>` and owning `<module>.<role>` for each of the entry's modules, with the entry's library lists; siblings become a nested array. The entry itself is no layer. |
| a `shape` entry | the template's `allow`, `require`, `forbid`, `extra` and `hints`; a key the entry sets wins |
| a `contexts` entry | `<module>.<name>` for each of the context's modules and each `public` name, added to the context's own `public` |

In the example, the `domain` entry becomes nine layers, from `domain.constants` to `domain.router`, so `src.orders.service` importing `src.orders.router` is INW001, and so is `src.orders.schemas` importing `src.orders.models`, its sibling. Every domain is covered by `src.*`, including the next one. `src.orders.router` may import `src.users.service`: orders depends on users, and `service` is public. Any import of `src.users.models` from orders is INW003. The routers are public because `src.main` mounts them, and `src.main` is in no context.

Templates are expanded when the config is read, before anything else is checked, so the rules, the baseline, the brief and the editor see only the result, which a config could also spell out by hand. [The test fixture](https://github.com/SirCypkowskyy/inwards/tree/develop/src/cli/test/support/fixtures/templates/fastapi) holds this config and its hand-written equivalent, and the tests check that they parse to the same config and give the same diagnostics. What that means in practice:

- **Messages name the role layers**, such as `Layer "domain.service" imports "src.orders.router" from outer layer "domain.router"`.
- **A role no package has is an empty layer.** A role layer that matches no module gets the INW006 error for an empty layer, like any other layer, so list only the roles every kind of package can have; the optional ones can live in `allow`. The error points at the entry that carries the template and names the role.
- **Use `*`, not `**`, in a template entry's modules.** `src.*` gives `src.*.models`, which only matches a domain's own `models`, so `src/orders/service/models.py` stays in the `service` role. With `src.**`, `src.**.models` matches that file too, and it moves to the `models` role, because the deepest last literal segment wins ([Selectors](#selectors)).
- **Config errors name the entry or the template key**: `tool.inwards.layers[1].template` for an unknown template or one without roles, `tool.inwards.templates.fastapi-domain.roles[2]` for a bad role. A problem only the expansion shows, such as a role layer's name already taken, names the expanded layer.

#### Rules for a role { #template-rules }

A template's `rules` table turns [opt-in rules](../rules/index.md#opt-in-rules) on for the modules of one role, so "every router gets INW013" is said once, next to the roles:

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "core", modules = ["src.database"] },
  { name = "domain", modules = ["src.*"], template = "domain" },
]

[tool.inwards.templates.domain]
roles = ["models", "service", "router"]

[tool.inwards.templates.domain.rules]
router = { async-blocking = true, thin-endpoint = { max-statements = 8 } }
models = { orm-naming = "warning" }
```

Each key is a role the template lists (quote a dotted one: `"api.v1"`), and each value names rules by their kebab-case names. A rule's value is `true`, a severity (`"error"` or `"warning"`), or a table of the rule's options without `modules`. The template expands into `[tool.inwards.rules]`, and the result is what you would write by hand:

<!-- config: fragment -->

```toml
[tool.inwards.rules]
extend-select = ["INW012", "INW013", "INW016"]
severity = { INW016 = "warning" }

[tool.inwards.rules.async-blocking]
modules = ["src.*.router"]

[tool.inwards.rules.thin-endpoint]
modules = ["src.*.router"]
max-statements = 8

[tool.inwards.rules.orm-naming]
modules = ["src.*.models"]
```

- **The role's modules** are its layer's modules: `<module>.<role>` for every module of every `layers` entry that uses the template. They join the rule's `modules`, so the rule reports only there. [INW015](../rules/INW015.md) is the exception: they join its `role`, the modules it guards, and its `modules` stays as the top-level table sets it.
- **The rule is turned on**: its code joins `extend-select`, after the codes already there. `ignore` still wins.
- **The top-level table adds to it.** `[tool.inwards.rules.<rule>]` `modules` (or INW015's `role`) entries come first, then the roles'. Any other option set there, and a severity in `[tool.inwards.rules] severity`, wins over the template's, as a shape entry's own key wins over its template's. Once a template names a rule, a top-level table without `modules` no longer means the whole project: the rule's scope is the template's roles plus the top-level `modules`.
- **One value per option.** Two roles, or two templates, that give the same rule different values for one option, or different severities, are a config error that names both; set the value once in the top-level table instead.
- **Config errors name the key**, such as `tool.inwards.templates.domain.rules.router.async-blocking.modules`: a role the template doesn't list, a template without `roles`, an unknown rule or a rule code, a rule that is on by default (it already reports everywhere, so set its `modules` in the top-level table to narrow it), a value other than `true`, a severity or a table, `modules` (or INW015's `role`) in a template table, and an option the rule doesn't take. A template with `rules` that no `layers` entry uses is an error too, since its roles match no modules.

A template nobody uses is allowed. Four presets write a template and contexts for you: `inwards init --style vertical-slices`, `bounded-contexts`, `django` and `fastapi`, the last one the fastapi-best-practices template above ([Install](install.md#a-new-project-start-from-a-preset)). [ADR-036](../05-ADR.md#adr-036-package-templates-expand-into-config-a-user-could-write-by-hand) records the design.

### `cycles` { #cycles }

Type: list of `"modules"` and `"contexts"`. Default: `["contexts"]`.

Which import cycles [INW004](../rules/INW004.md) reports on whole-project runs: between contexts, between modules, both, or none (`[]`). The default only matters once `contexts` are declared, so upgrading doesn't fail a project that lives with module cycles; add `"modules"` to catch those too.

<!-- config: fragment -->

```toml
[tool.inwards]
cycles = ["modules", "contexts"]
```

### `diagrams` { #diagrams }

Type: list of paths. Default: none.

Markdown and Mermaid files whose architecture diagrams [INW017](../rules/INW017.md) (names) and [INW018](../rules/INW018.md) (arrows) check against `[tool.inwards]` and the code on whole-project runs. Each entry is a path relative to the pyproject.toml; a segment may use `*`, `?` and `[seq]`, and `**` stands for any number of directories. An entry can't be absolute or climb out with `..`. In a listed file, only a Mermaid `flowchart` or `graph` that opens with `%% inwards: layers` or `%% inwards: contexts` is read: a fenced `mermaid` block in a Markdown file, or the whole of a `.mmd` or `.mermaid` file. The diagram is checked, never read as config. Both rules are opt-in, so turn them on with `extend-select`; [`inwards import-diagram`](diagrams.md#import-diagram) writes a first `[tool.inwards]` from a diagram. [ADR-045](../05-ADR.md#adr-045-architecture-diagrams-are-checked-against-toolinwards-never-read-as-config) has the details.

<!-- config: fragment -->

```toml
[tool.inwards]
diagrams = ["docs/architecture.md", "docs/**/*.mmd"]
rules = { extend-select = ["INW017", "INW018"] }
```

## Monorepos and uv workspaces { #monorepos }

Inwards follows [uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/): the member list lives in `[tool.uv.workspace]` at the workspace root, and each member keeps its own `[tool.inwards]` in its own `pyproject.toml`. There is no Inwards key for it ([ADR-035](../05-ADR.md#adr-035-inwards-check-follows-uv-workspace-members-each-with-its-own-config)).

```toml
# pyproject.toml at the workspace root
[tool.uv.workspace]
members = ["packages/*"]
```

```toml
# packages/core/pyproject.toml
[project]
name = "acme-core"

[tool.inwards]
root = "src"
layers = [
  { name = "domain", modules = ["acme.core.domain"] },
  { name = "services", modules = ["acme.core.services"] },
]
```

Without `--config`, `inwards check` picks the configs like this:

- **At the workspace root** (or any directory that holds members), it checks every member below it that has `[tool.inwards]`, each against its own config and its own baseline. A config at the workspace root itself checks the rest of the tree, with those members' directories left out, and a member nested in another member is left to its own config, so no file is checked twice. A member without `[tool.inwards]` is listed as not checked, unless the root's config checks it. A config above the workspace root belongs to another project and isn't used.
- **Inside a member**, it uses the nearest config, as it does outside a workspace.
- **With paths**, each path goes to the nearest config above it, and a directory that holds configured members goes to each of theirs too. `inwards check packages/api/src packages/core/src/acme/core/domain/order.py` checks the first against `packages/api`'s config and the second against `packages/core`'s. The workspace is looked for from each path, so the answer doesn't depend on where you run the command, and members under a named directory that no config checks are listed as not checked. A path with no config above it is reported as not checked.
- **`--config`** checks every path against that one config, as before.

Members come from `members` less `exclude`, with `*` matching inside one path segment (`packages/*`, `libs/acme_*`); `**`, `?` and character classes match nothing.

The output is one report: JSON and SARIF are one document, and paths are relative to the working directory. Text and concise output end with a line per config. The exit code is the worst of the configs': 1 when any member has an error, 2 when a member's config is invalid (the other members are still checked and reported), and 2 when no named path gave a file to check. With `--log`, each config gets its own line in its own run log. The [fixture the tests use](https://github.com/SirCypkowskyy/inwards/tree/develop/src/cli/test/support/fixtures/workspace), checked from its root:

```text
warning: packages/tools has no [tool.inwards] table, so it was not checked.
All clear: 6 files, 0 violations (114.8 ms).
packages/api/pyproject.toml: 2 files, 0 violations, 0 warnings
packages/core/pyproject.toml: 4 files, 0 violations, 0 warnings
```

Members often share an implicit namespace package: `packages/core/src/acme/core` and `packages/api/src/acme/api`, with no `acme/__init__.py`. Python merges `acme` from both members, and Inwards names the modules the same way, so a relative import such as `from ..core import model` means `acme.core.model` in either member. When a module under such a package is missing from the member being checked, [INW010](../rules/INW010.md) looks for it in the other members (their `src/`, else the member directory) and in the workspace's `.venv` before reporting it.

The Claude Code hooks need nothing more: each edited file is checked against the nearest config recorded at session start, the Stop gate checks each changed file against its own member's config, and the config guard protects every member's `[tool.inwards]` and baseline. `inwards baseline` still takes one config per run: `inwards baseline --config packages/core/pyproject.toml`.
