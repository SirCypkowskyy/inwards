# Architecture diagrams { #architecture-diagrams }

Inwards keeps a Mermaid drawing of your architecture in step with `[tool.inwards]`, in both directions ([ADR-045](../05-ADR.md#adr-045-architecture-diagrams-are-checked-against-toolinwards-never-read-as-config)):

- **The docs follow the code.** [INW017](../rules/INW017.md) reports a name in the diagram that the config or the code doesn't know, and [INW018](../rules/INW018.md) an arrow that draws an import the config forbids.
- **The docs drive the code.** `inwards import-diagram` turns a diagram into a first `[tool.inwards]`, once. From then on the two rules keep them in step.

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

## Check a diagram { #check }

List the files and turn the rules on:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards]
diagrams = ["README.md", "docs/**/*.md", "docs/**/*.mmd"]

[tool.inwards.rules]
extend-select = ["INW017", "INW018"]
```

Both are warnings, so a drawing that drifted doesn't block an agent's Stop gate; `severity = { INW017 = "error", INW018 = "error" }` makes them block. They run on whole-project runs: `inwards check` without paths, or the Stop gate with `stop-gate = "project"`.

## Start from a diagram { #import-diagram }

Draw the architecture first, then let `import-diagram` write the config:

```sh
inwards import-diagram docs/architecture.md            # print the table on stdout, notes on stderr
inwards import-diagram docs/architecture.md --write    # append it to pyproject.toml
```

- **Input.** One Markdown file (each marked `mermaid` block in it) or one `.mmd` file, with at most one layers diagram and one contexts diagram.
- **Output.** The table lists the file in `diagrams` and turns INW017 and INW018 on, so the diagram stays checked. A file outside the working directory isn't listed, since `diagrams` entries can't climb out with `..`.
- **`--write`** appends the table to `pyproject.toml` in the working directory. It refuses, with exit code 2 and nothing written, when there is no `pyproject.toml` or it already has `[tool.inwards]`: it never overwrites or merges. Print the table instead and merge it by hand.
- **`root`.** When the packages live in `src/`, the table gets `root = "src"`, as `inwards init` would pick it.
- **Checked first.** The table must parse as an Inwards config, or the command stops with exit code 2 and says why: two layers with the same quoted label, a `public` node outside its context's module.

What is refused, with the line: a cycle among the layers; a context, or a `:::public` node, without a quoted label, because a context needs modules; a second diagram of one kind in the file. A layer without a quoted label gets `modules = []` and a note on stderr: fill it in before checking. A file with only a contexts diagram gets one layer, `app`, that holds every context.

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

## Limits { #limits }

- **Mermaid flowcharts only.** C4, `architecture-beta` and PlantUML diagrams aren't read yet.
- **What Mermaid can't say stays out.** Library lists, shapes, selectors other than a node's label, rule options and `ignore` are written by hand after the import.
- **Imports the diagram doesn't draw** aren't reported yet; that is INW019 ([#332](https://github.com/SirCypkowskyy/inwards/issues/332)).
- **Whole-project runs only.** The per-edit hook and the editor don't show diagram findings.
