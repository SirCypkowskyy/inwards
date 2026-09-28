# Package shape

Layer rules (INW001) look at imports. They can't see where code *lives*: a new `helpers.py` next to `service.py`, a `services/` package beside `service.py`, or a `test_orders.py` inside the app all pass them. Package shape closes that gap. You say which members a package may, must and must not hold, and Inwards checks it on every edit (the hook), in the editor (the language server) and in CI (`inwards check`).

| Rule | Reports | Where |
|---|---|---|
| INW007 `package-shape` | a member the shape doesn't allow (`extra`, error by default) or forbids; a name outside its `only-in` packages; a shape selector matching no package (warning) | on the file, line 1; a dead selector in `pyproject.toml` |
| INW008 `missing-member` | a member the shape requires is absent | on the package's `__init__.py`, or its first file without one |

## Configure it

<!-- config: fragment -->

```toml title="pyproject.toml"
[[tool.inwards.shape]]
packages = ["app.*"]                  # which packages: selectors, see below
allow = ["router", "schemas", "utils"] # what else they may hold
require = ["__init__", "router", "service"]
forbid = ["conftest"]
extra = "error"                       # or "warning" for members allow doesn't cover

[[tool.inwards.names]]
pattern = "test_*"
only-in = ["tests", "tests.**"]
```

- **Selectors** (`packages`, `only-in`) match packages, in [import-linter's grammar](../05-ADR.md#adr-018-package-selectors-take-globs-from-the-start-monorepos-follow-uv-workspaces): `a.b` is exact, `a.*` is one segment below `a`, `a.**` is any depth below `a` (not `a` itself). A new domain such as `app/payments/` is covered by `app.*` the moment it exists.
- **The first matching entry wins.** Put exact entries before the globs that would also match them. An entry whose selector an earlier one already covers could never apply, so it is a config error: `app.orders` after `app.*`, a repeated selector, or `app.*` after `app.**`. A glob that only overlaps an earlier one (`app.**` after `app.*`) is fine. Selector segments are Python identifiers, `*` or `**`.
- **Member patterns** are fnmatch globs (`*`, `?`, `[seq]`, `[!seq]`), matched as Python's `fnmatch.fnmatchcase` matches them: inside `[...]`, `*` and `?` are literal. A `[` that is never closed, or a reversed range such as `[z-a]`, is a config error. `name` is a module or a subpackage, `name/` a subpackage only, `name.py` a module only (`.pyi` stubs count as modules). `__init__` is always allowed, and so is everything in `require`. Without `allow`, any member is allowed and only `require` and `forbid` apply.
- **A shape covers a package's direct members.** `app/orders/services/x.py` is member `services/` of `app.orders`; the files inside `services/` answer to a shape for `app.orders.services`, if one exists. Members are named from the file system: `utils.helpers.py` is one module member, not `utils/`, so it matches neither `utils` nor `helpers`. Hidden files and directories are skipped, as every Inwards file walk skips them.
- **Names rules** apply at every level: a member matching `pattern` anywhere outside the `only-in` packages is an INW007 error.

Unknown keys, malformed selectors or patterns, and shadowed entries are config errors (exit 2). The [config guard](../04-AI-Integration.md) treats `shape` and `names` like the rest of `[tool.inwards]`: an agent's edit to them is denied.

## What the agent sees

The message names the member and the package, never the allowed list, so a baseline entry survives a change to `allow`. The fix steps list the allowed members and name the one the code most likely belongs in, found through built-in synonyms (`helpers` → `utils`, `services` → `service`, `test_*` → `tests`), a suffix match (`order_service` → `service`) or a small edit distance (`rooter` → `router`; 2 edits for names of 6 characters or more, 1 for 3 to 5, none below that, so `db.py` isn't sent to `di.py`):

```text
app/orders/helpers.py:1:1: INW007 "helpers.py" is not an allowed member of package "app.orders".
  fix: Move the code in "helpers.py" into utils.py.
    1. Move the code into app/orders/utils.py and delete helpers.py.
    2. Package "app.orders" may hold: router, schemas, models, service, dependencies, config, constants, exceptions, utils.
```

- **Per edit (PostToolUse).** INW007 blocks (exit 2) when the edited file is new this session. For a file that already existed when the session started, it goes back as context only, so legacy layout never blocks an unrelated edit. INW008 for the edited package is always context: the agent creating `app/payments/router.py` hears that `service.py` is still missing, and can add it next.
- **Stop gate.** INW008 findings that are new since the session started block the turn, so deleting a required `service.py` through Bash is caught. A package that already lacked it at session start doesn't block. INW007 on files that predate the session doesn't block either.
- **Editor.** The language server reports INW007 on each open file as you type. A workspace pass over the directory listing (nothing is read or parsed) pushes INW007 to files you haven't opened and INW008 to the package's `__init__.py`. It follows symlinks that stay inside the config root, like `inwards check`, and runs again, once per burst of events, whenever a Python file is created or deleted.
- **CI.** A whole-project `inwards check` reports INW007 on every file, INW008 for every shaped package, and a warning for a selector that matches no package.

## Example: fastapi-best-practices

The [fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices) layout gives each domain the same modules: router, schemas, models, service, dependencies, config, constants, exceptions and utils. The guide names its top package `src`; here it is `app`. Tests live in a top-level `tests/` package.

```toml title="pyproject.toml"
[tool.inwards]
ignore = ["tests"]
layers = [{ name = "app", modules = ["app"] }]

# An integration package: a client, no routes. Exact entries come before the
# glob that would also match them.
[[tool.inwards.shape]]
packages = ["app.aws"]
allow = ["client", "schemas", "config", "constants", "exceptions", "utils"]
require = ["__init__", "client"]

# Every domain package, including the ones added later.
[[tool.inwards.shape]]
packages = ["app.*"]
allow = [
  "router", "schemas", "models", "service", "dependencies",
  "config", "constants", "exceptions", "utils",
]
require = ["__init__", "router", "service"]

# Tests live under tests/, never next to the code.
[[tool.inwards.names]]
pattern = "test_*"
only-in = ["tests", "tests.**"]
```

## Example: clean architecture

The [clean-architecture tree](https://rothl.com/blog/clean-architecture-python-guide) splits the code into domain (`model/`), application (`ports/` and `use_cases/`) and infrastructure (`adapters/` and the composition root `di.py`). Each layer package gets an exact shape; an empty `allow` means only the required members and `__init__`.

```toml title="pyproject.toml"
[tool.inwards]
ignore = ["tests"]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
  { name = "main", modules = ["shop.main"] },
]

[[tool.inwards.shape]]
packages = ["shop"]
allow = ["domain/", "application/", "infrastructure/", "main.py"]

[[tool.inwards.shape]]
packages = ["shop.domain"]
require = ["__init__", "model/"]
allow = []

[[tool.inwards.shape]]
packages = ["shop.application"]
require = ["__init__", "ports/", "use_cases/"]
allow = []

# The composition root must exist, and only adapters sit beside it.
[[tool.inwards.shape]]
packages = ["shop.infrastructure"]
require = ["__init__", "adapters/", "di.py"]
allow = []

[[tool.inwards.names]]
pattern = "test_*"
only-in = ["tests", "tests.**"]
```

Both configs are test fixtures (`src/cli/test/support/fixtures/shapes/`): each passes `inwards check` with 0 findings, and the tests plant `helpers.py`, `services/x.py` and `test_x.py` to check that each fails with the fix above.

## Shapes from a preset

`inwards init --style layered|clean|hexagonal --scaffold` writes shapes that fit its example package. The package itself holds only its layer packages, `bootstrap.py` and `__main__.py`, and `adapters/` in `hexagonal` holds only `inbound/` and `outbound/`; any other member there is an error, because no layer would hold it. In `clean` and `hexagonal`, `application/` must hold `ports/` and `use_cases/`, and any other member there is a warning. The layer packages have no shape, so they grow freely. [Install](install.md#a-new-project-start-from-a-preset) lists them; `inwards init --list-styles` prints them.

## Not covered yet

Named templates, role layering and `inwards init --style fastapi` ([#97](https://github.com/SirCypkowskyy/inwards/issues/97)), non-Python files, and what a file contains.
