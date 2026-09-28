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

Editors that use [Taplo](https://taplo.tamasfe.dev/) (Even Better TOML in VS Code, and others) attach schemas to whole files: Taplo ignores a rule's `keys` when it picks the schema, so the table schema alone would be checked against the entire `pyproject.toml`. Use the whole-file schema built from it instead, <https://sircypkowskyy.github.io/inwards/schema/pyproject.json>, which checks `[tool.inwards]` and leaves every other table alone. A `.taplo.toml` next to `pyproject.toml`:

```toml title=".taplo.toml"
[[rule]]
include = ["**/pyproject.toml"]

[rule.schema]
path = "https://sircypkowskyy.github.io/inwards/schema/pyproject.json"
```

This replaces the schema Taplo would otherwise take from SchemaStore for that file, so the other tables go unchecked until Inwards' schema is part of SchemaStore's ([#192](https://github.com/SirCypkowskyy/inwards/issues/192)). Releases attach it as `inwards-pyproject-schema.json`.

The schema checks structure: the keys, their types, the allowed values, the rule codes and the shape of names and patterns. Inwards checks more when it reads the config:

- relations between entries: unique layer and context names, a prefix in two layers or two contexts, `public` entries a context owns, `depends-on` names that exist;
- exact module names, where the schema accepts a slightly looser form, and glob ranges written backwards, such as `[z-a]`;
- `required-version` against the running binary.

So a config the schema accepts can still be a config error, and the error names the key.

## Keys { #keys }

### `root` { #root }

Type: string. Default: `"."`.

The directory, relative to `pyproject.toml`, that module names are computed from. With `root = "src"`, `src/shop/domain/order.py` is the module `shop.domain.order`.

One config has one root. In a uv workspace whose members each have their own `src/` (`src/packages/core/src/core`), give each member its own `[tool.inwards]`: `inwards check` at the workspace root then checks every member with its own config ([Monorepos and uv workspaces](#monorepos)). A single config at the workspace root would name that package `packages.core.src.core`, and other members' `import core` would pass as a third-party import, so `inwards check` warns about each member it indexes that way ([INW006](../rules/INW006.md)).

### `layers` { #layers }

Type: array of tables, at least one. Required.

The layers, innermost first. A module may import its own layer and any layer listed before it; importing a layer listed after it is INW001. Each layer has:

- `name`: a non-empty string, unique among layers.
- `modules`: module prefixes. `shop.domain` owns `shop.domain` and everything under it, but not `shop.domainx`. When several prefixes match a module, the longest wins, so a nested package can sit in a different layer from its parent. The same prefix in two layers is a config error.
- `allow-libraries`, `deny-libraries`, `extend-deny-libraries`: which libraries the layer may import (INW005). The [libraries guide](libraries.md#configure-it) has the details.

### `required-version` { #required-version }

Type: string, `"MAJOR.MINOR.PATCH"`. Default: none.

The oldest Inwards allowed to check the project. An older binary fails with a config error instead of checking with rules it may not know. `inwards init` sets it.

### `ignore` { #ignore }

Type: list of module names. Default: none.

Modules left out of the INW006 warning about code outside every layer, such as `tests` or `migrations`. An entry matches whole name segments anywhere in a module name: `migrations` covers `shop.orders.migrations.0001_initial`. Imports from a layer into them are still checked.

<!-- config: fragment -->

```toml
[tool.inwards]
ignore = ["tests", "scripts", "migrations", "conftest"]
```

### `generated` { #generated }

Type: list of module patterns. Default: `["*_pb2", "*_pb2_grpc", "_version"]`.

Modules a build step writes, which INW010 treats as existing when they aren't on disk. Segments may use `*` and `?`; a pattern matches whole segments anywhere in a module name. A list, even an empty one, replaces the default. [ADR-029](../05-ADR.md#adr-029-generated-modules-pass-inw010-protoc-and-version-modules-by-default) has the details.

<!-- config: fragment -->

```toml
[tool.inwards]
generated = ["*_pb2", "*_pb2_grpc", "_version", "shop.api.gen"]
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

- `select`: only these rules report. It needs at least one code.
- `ignore`: these rules don't report. It wins over `select`.
- `severity`: a table of rule code to `"error"` or `"warning"`.

INW000 can't be ignored or re-levelled. [ADR-027](../05-ADR.md#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table) has the details.

<!-- config: fragment -->

```toml
[tool.inwards.rules]
ignore = ["INW007", "INW008"]
severity = { INW005 = "warning" }
```

### `shape` and `names` { #shape }

Type: arrays of tables. Default: none.

Which members a package may, must and must not hold (INW007, INW008), and where a member name may appear. The [package shape guide](package-shape.md) covers both tables and their selector and pattern syntax.

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
- `public` (default `[]`): prefixes of the context's own modules that the contexts depending on it may import. They are full module names, not relative to the context: `api` means the top-level module `api`. Each one must belong to this context; a prefix another context owns more specifically is a config error. A module is public when it lies at or under a public prefix and this context owns it.
- `depends-on` (default `[]`): the contexts this one may import from. It is direct: not passed on, and not granted in return. A name may refer to a context declared further down. The context's own name, an unknown name and a repeated name are config errors.

Contexts and layers add up: a declared dependency or a public module never allows an import that the layer order forbids, and belonging to a context says nothing about the layer, or the other way round. A context uses only its own `depends-on` and `public`, even when its prefixes sit inside another context's. [ADR-030](../05-ADR.md#adr-030-bounded-contexts-as-a-contexts-table-of-literal-prefixes) has the reasoning.

### `cycles` { #cycles }

Type: list of `"modules"` and `"contexts"`. Default: `["contexts"]`.

Which import cycles [INW004](../rules/INW004.md) reports on whole-project runs: between contexts, between modules, both, or none (`[]`). The default only matters once `contexts` are declared, so upgrading doesn't fail a project that lives with module cycles; add `"modules"` to catch those too.

<!-- config: fragment -->

```toml
[tool.inwards]
cycles = ["modules", "contexts"]
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

Members often share an implicit namespace package: `packages/core/src/acme/core` and `packages/api/src/acme/api`, with no `acme/__init__.py`. Python merges `acme` from both members, and Inwards names the modules the same way, so a relative import such as `from ..core import model` means `acme.core.model` in either member. When a module under such a package is missing from the member being checked, [INW010](../rules/INW010.md) looks for it in the other members (their `src/`, else the member directory) before reporting it.

The Claude Code hooks need nothing more: each edited file is checked against the nearest config recorded at session start, the Stop gate checks each changed file against its own member's config, and the config guard protects every member's `[tool.inwards]` and baseline. `inwards baseline` still takes one config per run: `inwards baseline --config packages/core/pyproject.toml`.
