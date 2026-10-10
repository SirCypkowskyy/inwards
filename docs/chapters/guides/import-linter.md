# Migrating from import-linter { #migrating-from-import-linter }

[import-linter](https://import-linter.readthedocs.io/) contracts convert to a `[tool.inwards]` table in one command. `inwards import-config` reads the contracts, prints the table, and says for each contract whether it was carried over in full, in part, or not at all, and why.

## Convert { #convert }

Run it where `lint-imports` runs:

```sh
inwards import-config            # print the table on stdout, the report on stderr
inwards import-config --write    # append the table to pyproject.toml
inwards import-config setup.cfg  # read this file instead of looking for one
```

Without a file it looks where `lint-imports` does, in the current directory and in this order: `setup.cfg` (its `[importlinter]` sections), `.importlinter`, then `pyproject.toml` (`[tool.importlinter]`). A file whose name ends in `.toml` is read as TOML, anything else as INI.

- **Output.** The table goes to stdout, so `inwards import-config > inwards.toml` keeps only TOML. The report goes to stderr.
- **`--write`** appends the table to the `pyproject.toml` next to the import-linter config. It refuses, with exit code 2 and nothing written, when that file has no `pyproject.toml` next to it, or when `pyproject.toml` already has `[tool.inwards]`: it never overwrites or merges into an existing table. Print the table instead and merge it by hand.
- **`root`.** When the root package lives in `src/` (`src/<package>`, or a `uv_build` project), the table gets `root = "src"`, as `inwards init` would pick it.
- **Exit codes.** 0 when the table was printed or written, even if some contracts couldn't be converted (the report lists them). 2 when no import-linter config was found, the file doesn't parse, or `--write` refused.

The table is checked before it is printed: it must parse as an Inwards config, or the command stops with exit code 2.

## An example { #an-example }

This `.importlinter` has a layers contract with two independent siblings, a forbidden contract with an ignored import, and a protected contract:

```ini title=".importlinter"
[importlinter]
root_package = shop
include_external_packages = True

[importlinter:contract:layers]
name = Web on top, the domain at the bottom
type = layers
layers =
    shop.web
    shop.orders | shop.billing
    shop.domain

[importlinter:contract:pure-domain]
name = The domain stays pure
type = forbidden
source_modules = shop.domain
forbidden_modules = pydantic
ignore_imports = shop.domain.money -> pydantic

[importlinter:contract:db]
name = Only the repository imports the database
type = protected
protected_modules = shop.db
allowed_importers = shop.repository
```

`inwards import-config` prints:

```toml title="pyproject.toml"
# Converted from .importlinter by inwards import-config.
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"], extend-deny-libraries = ["pydantic"] },
  [
    { name = "orders", modules = ["shop.orders"] },
    { name = "billing", modules = ["shop.billing"] },
  ],
  { name = "web", modules = ["shop.web"] },
]
```

and reports:

```text
inwards import-config: converted 2 of 3 contracts from .importlinter.
  mapped  layers ("Web on top, the domain at the bottom")
  partial pure-domain ("The domain stays pure")
          ignore_imports (shop.domain.money -> pydantic) has no equivalent: add an inline suppression with a reason at each import, or run `inwards baseline` once the config is in place.
  skipped db ("Only the repository imports the database")
          protected contracts have no equivalent: Inwards limits what a context exposes (`public`), not who may import it.
Inwards checks direct imports only: an import chain through a third module, which import-linter follows, isn't reported.
Inwards also runs rules import-linter doesn't have (INW006 for code outside every layer, INW005's default deny list on the innermost layer, INW010, INW011): run `inwards check`, then `inwards baseline` to accept what is there today.
```

## How contracts map { #how-contracts-map }

| import-linter | Inwards | Rule |
|---|---|---|
| `layers`, listed high to low | `layers`, listed innermost first: the order is reversed | INW001 |
| a layer line `a : b` (siblings that may import each other) | one layer holding both modules | INW001 |
| a layer line `a | b` (independent siblings) | [sibling layers](configuration.md#sibling-layers): a nested array in `layers`, one layer per module, in the line's place | INW001 |
| `containers` | every layer repeated under each container, in the same Inwards layer | INW001 |
| `(optional)` layers | a plain layer; reported, because a prefix that matches no module gets an INW006 warning | INW006 |
| `exhaustive = true` | reported: a module outside every layer gets the INW006 warning, not an error | INW006 |
| `exhaustive_ignores` | `ignore`, one entry per container | INW006 |
| `independence` | one context per module, none depending on another | INW002 |
| `forbidden`, first-party `forbidden_modules` | one context per source and forbidden module; each source's `depends-on` leaves out what it may not import | INW002 |
| `forbidden`, external `forbidden_modules` | `extend-deny-libraries` on the layers that hold exactly the source modules; otherwise a `deny` entry in `[tool.inwards.rules.pure-domain]` for the source modules | INW005 |
| `root_package`, `root_packages` | with no layers contract, one layer holding the root packages; they also decide which forbidden modules are external | |

A forbidden pair covers everything below its two ends, as import-linter's packages do: when `shop.a` may not import `shop.c`, a context declared inside `shop.a` may not import `shop.c` either. Each generated context is public in full (`public` is its own module), so [INW003](../rules/INW003.md) reports nothing extra, and `cycles = []` keeps [INW004](../rules/INW004.md) from reporting cycles between the new contexts, which import-linter didn't check.

When there are several layers contracts, the first one sets the layer order. A later one joins it when it has the same layers in other containers, or when every module it lists is already a layer in the same order. Anything else is reported: Inwards has one layer order per config.

## What doesn't convert { #what-doesnt-convert }

Each of these is reported with its contract, never dropped silently:

- **`ignore_imports`.** Inwards has no config-level exception for one import. After writing the table, run `inwards check`, then either add an inline suppression with a reason at each import (`# inwards: ignore[INW002] reason="..."`, see [ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)) or accept today's violations with `inwards baseline` ([on an existing codebase](install.md#on-an-existing-codebase)).
- **Wildcards** (`mypackage.*`, `mypackage.**.models`) in any module list. Inwards takes literal module names; the contract is skipped, and you list the modules the wildcard matches by hand.
- **`as_packages = false`.** An Inwards module name always covers everything below it.
- **`protected` contracts.** Inwards limits what a context exposes to others (`public`, [INW003](../rules/INW003.md)), not which modules may import it.
- **`acyclic_siblings` contracts.** [INW004](../rules/INW004.md) reports cycles between modules or between contexts, not between sibling packages; set `cycles = ["modules", "contexts"]` by hand if that is close enough.
- **Custom contract types**, and a layer line that mixes `|` and `:` (import-linter rejects it too).
- **`broken_contract_guidance`.** Inwards writes its own fix steps for each violation.

## What changes after the switch { #what-changes-after-the-switch }

- **Direct imports only.** import-linter follows import chains: in a layers contract, `low` may not import `utils` when `utils` imports `high`. Inwards checks each import on its own, so that chain passes unless `utils` is in a layer.
- **Containers are checked against each other.** import-linter lets `foo.low` import `bar.high` when `foo` and `bar` are different containers. Inwards has one layer order for the project, so it reports that import.
- **Inwards' own rules run too.** [INW006](../rules/INW006.md) reports a layer importing first-party code that belongs to no layer (an error) and a package outside every layer (a warning). The innermost of two or more layers gets INW005's [default deny list](libraries.md#the-default-deny-list) of frameworks and I/O libraries. [INW010](../rules/INW010.md) reports imports of first-party modules that don't exist, and [INW011](../rules/INW011.md) dynamic imports. Run `inwards check` once and decide: fix, add the missing packages to a layer or to `ignore`, or accept what is there with `inwards baseline`.

A migration then looks like this: run `inwards import-config --write`, read the report, run `inwards check`, handle what it finds, and remove the `lint-imports` step from CI once `inwards check` passes there ([GitHub Actions](ci.md)).
