# Architecture diagrams { #architecture-diagrams }

Inwards keeps a Mermaid or PlantUML drawing of your architecture in step with `[tool.inwards]`, in both directions ([ADR-045](../05-ADR.md#adr-045-architecture-diagrams-are-checked-against-toolinwards-never-read-as-config)):

- **The docs follow the code.** [INW017](../rules/INW017.md) reports a name in the diagram that the config or the code doesn't know, [INW018](../rules/INW018.md) an arrow that draws an import the config forbids, and [INW019](../rules/INW019.md) an import in the code that the diagram doesn't draw.
- **The docs drive the code.** `inwards import-diagram` turns a diagram into a first `[tool.inwards]`, once. From then on the rules keep them in step.
- **The config draws the docs.** `inwards diagram` prints `[tool.inwards]` as a marked diagram that INW017 and INW018 accept and `import-diagram` reads back ([Draw the config](#diagram)).

`[tool.inwards]` stays the only source of truth: a diagram is never read as config while checking.

## Mark a diagram { #mark-a-diagram }

Only a Mermaid `flowchart` or `graph` that opens with a marker comment counts, in a file the [`diagrams`](configuration.md#diagrams) key lists: a fenced `mermaid` block in Markdown, or a whole `.mmd` file. Other Mermaid blocks are ordinary docs.

| In the diagram | `%% inwards: layers` | `%% inwards: contexts` |
|---|---|---|
| Node id | a layer name | outside a subgraph: a context name |
| Subgraph | (a group, no meaning) | a context; its id is the context name |
| `id["pkg.module"]`, a quoted label | the layer's module prefix or selector | the context's module, or a module inside it |
| Solid arrow `a --> b` | `a` may import `b`, so `b` is inner | the context of `a` depends on the context of `b` |
| `:::public` | | a `public` entry of the context; on the context itself, all of it |
| `:::external` | skipped | skipped |
| Dotted `-.->`, open `---`, two-way `<-->` | no meaning | no meaning |

A layer's rank is the longest path of solid arrows from it to a layer that points at nothing; layers of one rank are siblings, which may not import each other. A cycle of solid arrows has no order and is refused.

A layer or context whose name can't be a Mermaid id (a template's `slices.domain`) is named by a node whose quoted label is one of its `modules` entries.

### PlantUML { #plantuml }

A PlantUML component diagram counts the same way, with a `'` comment as the marker: `' inwards: layers` or `' inwards: contexts`, among the comment lines right after `@startuml`. Inwards reads each `@startuml` ... `@enduml` of a `.puml`, `.plantuml`, `.pu` or `.iuml` file, and each fenced `plantuml` or `puml` block in Markdown, where `@startuml` may be left out.

```text title="docs/layers.puml"
@startuml
' inwards: layers
component [shop.api] as api
component [shop.orders] as orders
component [shop.domain] as domain
database Postgres as db <<external>>
[api] --> [orders]
[orders] --> [domain]
[api] --> [db]
@enduml
```

| In the diagram | `' inwards: layers` | `' inwards: contexts` |
|---|---|---|
| `[name]`, `component name` | a layer name | outside a package: a context name |
| `package name { }`, and `node`, `folder`, `frame`, `cloud`, `rectangle` groups | (a group, no meaning) | a context; its name is the context name |
| `[pkg.module] as name`, `"pkg.module" as name` | the layer's module prefix or selector | the context's module, or a module inside it |
| Solid arrow `a --> b`, `a -> b`, `b <-- a`, `a -up-> b`, `a -[#red]-> b` | `a` may import `b` | the context of `a` depends on the context of `b` |
| `<<public>>` | | a `public` entry of the context; on the context itself, all of it |
| `<<external>>` | skipped | skipped |
| Dotted `..>`, plain `--`, two-way `<-->`, `-[dashed]->`, `--\|>` | no meaning | no meaning |

With an `as` alias, the alias is the name and the text in brackets or quotes is the module, like a quoted Mermaid label; without one, the bracket text is the name and there is no module. A name with spaces (`[Order handling] as orders`) is a caption. Colors, `skinparam`, `<style>`, notes, titles, `left to right direction`, interfaces and `!include` lines are skipped, and so is a line the reader can't follow.

## Check a diagram { #check }

List the files and turn the rules on:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards]
diagrams = ["README.md", "docs/**/*.md", "docs/**/*.mmd", "docs/**/*.puml"]

[tool.inwards.rules]
extend-select = ["INW017", "INW018", "INW019"]
```

All three are warnings, so a drawing that drifted doesn't block an agent's Stop gate; `severity = { INW017 = "error", INW018 = "error" }` makes them block. They run wherever a listed diagram is checked:

- **A whole-project run**: `inwards check` without paths, or the Stop gate with `stop-gate = "project"`. Only this run reports a `diagrams` entry that matches no file.
- **A named file**: `inwards check docs/architecture.md`. A Markdown, Mermaid or PlantUML file the key doesn't list isn't checked, and the report says so.
- **The [Claude Code hook](claude-code.md)**, after the agent edits a listed diagram (PostToolUse). A warning goes back to the agent as context; an error blocks the edit, as a code violation does. An edit of any other non-Python file costs a look at the config and nothing more. On the benchmark's 2,100-file synthetic project, on an M1 Pro, the hook took 37 ms p50 one-shot for a listed diagram (it lists the project's modules for INW017's labels) and 16.5 ms for another Markdown file, against 16.1 ms before.
- **The editor**: `inwards server` checks an open listed diagram on every keystroke, from the unsaved text ([Editors](editors.md#diagrams)).
- **[MCP `check_files`](mcp.md#check_files)**, by path or as text in `contents`.

The Stop gate's default scope (`stop-gate = "changed"`) checks the Python files the session changed, and no diagrams. A warning never blocks, so there is nothing to gate on by default; with the rules raised to errors, a diagram the agent broke has already blocked its own edit, and `stop-gate = "project"` checks every listed diagram at Stop as well. Editing Python code doesn't check a diagram again: a package renamed in the code shows up in the drawing on the next whole-project run, in CI or at a project-scope Stop.

INW019 compares the diagram with the imports the run collects: in a layers diagram a path of arrows draws an import, in a contexts diagram it takes a direct arrow, and an import under `if TYPE_CHECKING:` counts. It runs on whole-project runs only, since one edited or named file doesn't show the imports of the rest of the project.

## Start from a diagram { #import-diagram }

Draw the architecture first, then let `import-diagram` write the config:

```sh
inwards import-diagram docs/architecture.md            # print the table on stdout, notes on stderr
inwards import-diagram docs/architecture.md --write    # append it to pyproject.toml
```

- **Input.** One Markdown file (each marked `mermaid` and `plantuml` block in it), one `.mmd` file or one `.puml` file, with at most one layers diagram and one contexts diagram.
- **Output.** The table lists the file in `diagrams` and turns INW017 and INW018 on, so the diagram stays checked. A file outside the working directory isn't listed, since `diagrams` entries can't climb out with `..`.
- **`--write`** appends the table to `pyproject.toml` in the working directory. It refuses, with exit code 2 and nothing written, when there is no `pyproject.toml` or it already has `[tool.inwards]`: it never overwrites or merges. Print the table instead and merge it by hand.
- **`root`.** When the packages live in `src/`, the table gets `root = "src"`, as `inwards init` would pick it.
- **Checked first.** The table must parse as an Inwards config, or the command stops with exit code 2 and says why: two layers with the same quoted label, a `public` node outside its context's module.

What is refused, with the line: a cycle among the layers; a context, or a `:::public` node, without a quoted label, because a context needs modules; a second diagram of one kind in the file. A layer without a quoted label gets `modules = []` and a note on stderr: fill it in before checking. A file with only a contexts diagram gets one layer, `app`, that holds every context.

## Draw the config { #diagram }

`inwards diagram` goes the other way: it prints `[tool.inwards]` as a marked diagram, ready for a `.mmd` or `.puml` file or a fenced block in the docs.

```sh
inwards diagram                                  # the layers, as Mermaid
inwards diagram --contexts                       # the contexts
inwards diagram --format plantuml                # PlantUML, for either diagram
inwards diagram --config services/pyproject.toml
```

- **Layers.** One node per layer, outermost first, with its module as a quoted label, and a solid arrow from each layer to every layer one rank further in. A layer may import every layer inside it, so those arrows are enough, and the longest path gives each layer its rank back: siblings stay siblings.
- **Contexts.** A context without `public` modules is a node. One with them is a subgraph (a PlantUML `package`) that holds a `:::public` (`<<public>>`) node for each entry, an exact `=pkg.module` entry included. Each `depends-on` is an arrow from one context to the other.
- **Names.** A name that can be a node id is the id. Any other, such as a template's `slices.domain`, gets an id made from it (`slices_domain`) and is named by its first module, which INW017 and INW018 resolve ([Mark a diagram](#mark-a-diagram)). In PlantUML, a name with a hyphen, or one the reader would take for a keyword (`interface`, `package`), goes in brackets: `[interface] as "shop.api"`.
- **Round trip.** Against the same config, INW017 and INW018 find nothing in the output, as long as every module the config names exists (otherwise INW017 repeats INW006's finding on the diagram), and `inwards import-diagram` reads it back to the same layers, ranks and contexts. The tests check both for every preset's scaffold and both example apps, in both notations.
- **What it can't show** goes to stderr, one line each; the exit code stays 0:
    - A layer or context with two or more modules. Mermaid gets one node line per module, and `import-diagram` reads them all, but Mermaid draws a node with its last label. A PlantUML alias names one component, so the diagram keeps the first module. So does a context drawn as a subgraph or package.
    - A layer or context named after a Mermaid keyword (`class`, `style`, `end`) can't be a Mermaid node. `--format plantuml` draws it.
    - Library lists, shapes, rule options and `ignore`, as for `import-diagram`, and templates, which are drawn as the layers they expand into.
- **Exit code 2** for `--layers` together with `--contexts`, a `--format` other than `mermaid` or `plantuml`, or `--contexts` when the config declares no contexts.

To check the drawing, put it in a file the `diagrams` key lists. A `.mmd` or `.puml` file holds one diagram; for both, put each in its own fenced block of one Markdown file, which `import-diagram` also reads as one.

`inwards context` prints no diagram: the brief already lists every layer with what it may import, so a diagram would repeat it, and the fastapi preset's brief is near its 550-token budget already ([the brief](agents-md.md#the-architecture-brief-opt-in)).

## An example { #an-example }

A project with four packages and no config yet:

<!-- e2e -->

```toml title="pyproject.toml"
[project]
name = "shop"
version = "0.1.0"
```

<!-- e2e -->

```python title="shop/domain/order.py"
class Order:
    pass
```

<!-- e2e -->

```python title="shop/orders/place.py"
from shop.domain.order import Order
```

<!-- e2e -->

```python title="shop/billing/invoice.py"
from shop.domain.order import Order
```

<!-- e2e -->

```python title="shop/api/routes.py"
from shop.orders.place import Order
```

The layers as the team draws them, with orders and billing side by side:

<!-- e2e -->

```text title="docs/layers.mmd"
%% inwards: layers
flowchart TD
  api["shop.api"] --> orders["shop.orders"] & billing["shop.billing"]
  orders --> domain["shop.domain"]
  billing --> domain
  api --> db[("Postgres")]:::external
```

<!-- e2e -->

```sh
inwards import-diagram docs/layers.mmd
```

<!-- e2e -->

```text
# Converted from docs/layers.mmd by inwards import-diagram.
[tool.inwards]
diagrams = ["docs/layers.mmd"]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  [
    { name = "orders", modules = ["shop.orders"] },
    { name = "billing", modules = ["shop.billing"] },
  ],
  { name = "api", modules = ["shop.api"] },
]

[tool.inwards.rules]
extend-select = ["INW017", "INW018"]
inwards import-diagram: read 4 layers and 0 contexts from docs/layers.mmd.
```

`domain` points at nothing, so it is innermost; `orders` and `billing` both point only at it, so they share the next rank and become siblings; `api` is outermost. The database is `:::external` and doesn't become a layer. Write it and check:

<!-- e2e -->

```sh
inwards import-diagram docs/layers.mmd --write
inwards check
```

The project passes, the diagram included. Later, an arrow drawn from `orders` to `billing` would be INW018, and a code import between them INW001.

`inwards diagram` draws the config back. Each layer points at the layers of the next rank in, so `api` points at both siblings and they point at `domain`:

<!-- e2e -->

```sh
inwards diagram
```

<!-- e2e -->

```text
%% inwards: layers
flowchart TB
  api["shop.api"]
  orders["shop.orders"]
  billing["shop.billing"]
  domain["shop.domain"]
  api --> orders & billing
  orders & billing --> domain
```

A contexts diagram works the same way. This one

```text title="docs/contexts.mmd"
%% inwards: contexts
flowchart LR
  subgraph sales["shop.sales"]
    checkout["shop.sales.checkout"]
  end
  subgraph catalog["shop.catalog"]
    api["shop.catalog.api"]:::public
  end
  checkout --> api
```

becomes:

<!-- config: fragment -->

```toml
[[tool.inwards.contexts]]
name = "sales"
modules = ["shop.sales"]
public = []
depends-on = ["catalog"]

[[tool.inwards.contexts]]
name = "catalog"
modules = ["shop.catalog"]
public = ["shop.catalog.api"]
depends-on = []
```

## Coming from ArchUnitPython { #archunitpython }

[ArchUnitPython](https://github.com/LukasNiessen/ArchUnitPython) checks code against a PlantUML component diagram inside a pytest test (`project_slices(...).should().adhere_to_diagram_in_file(...)`). Inwards reads the same diagrams: `component [x]`, `[a] --> [b]` and `[a] -> [b]`, which is all its parser reads, plus everything in the [PlantUML table](#plantuml). The diagrams in ArchUnitPython's own tests and README are part of the reader's test suite.

To move a diagram over, mark it, give each component its module, and import it once:

1. Add `' inwards: contexts` after `@startuml`. ArchUnitPython's arrows allow direct dependencies, not transitive ones, and so does a context's `depends-on` ([INW002](../rules/INW002.md)).
2. Turn each `component [x]` into `component [package.x] as x <<public>>`. ArchUnitPython finds a component's code through the slice pattern in the test (`defined_by("src/(**)/**")`); Inwards needs the module in the diagram. `<<public>>` keeps ArchUnitPython's meaning that a component may import any module of a component it points at; without it, [INW003](../rules/INW003.md) allows only the modules you mark public.
3. Run `inwards import-diagram`, then `inwards check`.

A project laid out like ArchUnitPython's sample project, with three slices of one package:

<!-- e2e -->

```toml title="archunit/pyproject.toml"
[project]
name = "sample"
version = "0.1.0"
```

<!-- e2e -->

```python title="archunit/sample/controllers/users.py"
from sample.services.users import find_user
```

<!-- e2e -->

```python title="archunit/sample/services/users.py"
from sample.models.user import User


def find_user() -> User:
    return User()
```

<!-- e2e -->

```python title="archunit/sample/models/user.py"
class User:
    pass
```

ArchUnitPython's diagram, marked and with modules:

<!-- e2e -->

```text title="archunit/architecture.puml"
@startuml
' inwards: contexts
  component [sample.controllers] as controllers <<public>>
  component [sample.services] as services <<public>>
  component [sample.models] as models <<public>>
  [controllers] --> [services]
  [services] --> [models]
@enduml
```

<!-- e2e -->

```sh
cd archunit
inwards import-diagram architecture.puml --write
inwards check
```

<!-- e2e -->

```text
inwards import-diagram: read 1 layer and 3 contexts from architecture.puml.
```

Each component becomes a context with its arrows as `depends-on`, one layer, `app`, holds them all, and `inwards check` passes, the diagram included. Later, an import from `sample.models` into `sample.controllers` is INW002 in the code, and an arrow `[models] --> [controllers]` drawn in the diagram is INW018.

Where Inwards differs:

- **The diagram isn't the check.** ArchUnitPython judges the code against the diagram on every test run. Inwards checks the code against `[tool.inwards]` and the diagram against `[tool.inwards]`, so the two can't drift apart without a finding, and the hook, the editor and the agent brief all read the one config.
- **Code outside every component.** ArchUnitPython reports a dependency of a slice the diagram doesn't name, unless the test calls `ignoring_orphan_slices()`. Inwards leaves imports with an end outside every context alone, as `ignoring_orphan_slices()` does; INW006 warns about a module outside every layer.
- **Packages and other arrows.** ArchUnitPython ignores `package`, `..>` and styled arrows such as `-[#red]->`. In Inwards a package is a context in a contexts diagram, `..>` means no import, and a styled solid arrow is an arrow.
- **Layers too.** Marked `' inwards: layers` instead, the same diagram ranks its components as layers, where a layer may import every layer inside it, not only the one its arrow points at.
- **No `should_not()`.** A contexts diagram already forbids every arrow it doesn't draw, so a forbidden dependency needs no diagram of its own.

## Limits { #limits }

- **Mermaid flowcharts and PlantUML component diagrams only.** C4, `architecture-beta` and other PlantUML diagram types aren't read.
- **PlantUML is read one line at a time.** A statement split over lines (a component description that runs onto the next line) isn't followed, and a link to a component by its display name, rather than its alias, names a different node.
- **What a diagram can't say stays out.** Library lists, shapes, selectors other than a node's label, rule options and `ignore` are written by hand after the import.
- **Imports the diagram doesn't draw** are reported by [INW019](../rules/INW019.md) on whole-project runs only, never at edit time.
- **Imports between layers and contexts, not modules.** INW019 doesn't compare an arrow between two module nodes inside one context with the imports between those modules.
- **A code edit doesn't check the diagrams.** The hook and the editor check a diagram when it is edited; a rename in the Python code reaches the drawing on the next whole-project run.
- **Paths are matched as written.** A `diagrams` entry is compared with the path the agent or the editor gives, letter case included, so on a case-insensitive file system (macOS, Windows) `Docs/Architecture.md` doesn't match `docs/architecture.md` in the hook or the editor. The whole-project run walks the disk and isn't affected.
