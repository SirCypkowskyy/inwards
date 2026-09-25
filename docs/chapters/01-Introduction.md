# :material-layers-triple: Introduction

Inwards is an architecture linter for Python. You write down how your codebase is layered, and `inwards check` fails the moment an import crosses a line it shouldn't. It's built to sit inside the edit loop of AI coding agents like Claude Code, Aider and Copilot, because an agent can write a week's worth of imports in an afternoon and nobody reads all of them.

This chapter covers the problem, what Inwards does about it, and how the rest of the docs are organised.

## The problem: agents write code faster than anyone can review its shape

Ask an agent to "add a discount to orders" and it will do it. It may also reach for the SQLAlchemy session from inside your domain model, because the session is right there and the tests pass. The usual toolchain doesn't object:

- Ruff checks style and bug patterns inside a file. Its `banned-api` setting can forbid a module everywhere, but it has no notion of "allowed from here, forbidden from there".
- ty and mypy check types. A domain entity that imports an ORM table type-checks fine.
- Tests check behaviour. The behaviour is correct.
- Human review would catch it, but the agent produced 40 files in ten minutes and the reviewer is skimming.

The result is a codebase whose diagrams say "hexagonal" while the imports say "big ball of mud", one small shortcut at a time.

Agents add two failure modes of their own. They hallucinate: `from shop.domain.pricing import DiscountPolicy` looks plausible even when `pricing` doesn't exist. And when a check complains, they route around it by moving the import into a function body or behind `if TYPE_CHECKING:`. A guardrail for agents has to catch both.

!!! abstract "The bet behind Inwards"
    Agents satisfy the constraints they can see and run, and they ignore the ones that only live in a wiki page. Architecture rules usually live in the wiki. Chapter 2 turns this into a testable hypothesis.

Python already has architecture checkers, import-linter and pytest-archon above all. [Chapter 2](02-Business-Context.md#other-tools-in-this-space) compares them in detail. In short, none of them was designed to run after every agent edit and tell the agent how to repair the damage.

## What Inwards does

Inwards turns those wiki rules into a check that runs in milliseconds and talks back in a format an agent can act on.

```toml title="pyproject.toml"
[tool.inwards]
root = "src"
layers = [
  { name = "domain",         modules = ["shop.domain"] },
  { name = "application",    modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
  { name = "interface",      modules = ["shop.api"] },
]
```

<figure markdown="span">
  ![inwards check on a clean codebase](assets/screens/check-clean.svg){ loading=lazy }
  <figcaption>The example app as shipped: every import points inward.</figcaption>
</figure>

Layers are listed innermost first. A module may import its own layer and anything listed before it. Modules that match no layer (scripts, tests, migrations) are not checked today. An agent could use that gap by putting new code in a package outside every layer, so INW006, planned for 0.1, will flag unassigned first-party packages. When the domain imports infrastructure, you get this (abridged, one diagnostic out of the `diagnostics` array):

```json
{
  "code": "INW001",
  "file": "clean-app/shop/domain/order.py",
  "line": 14,
  "message": "Layer \"domain\" imports \"shop.infrastructure.sql_orders.SqlOrderRepository\" from outer layer \"infrastructure\".",
  "fix": {
    "summary": "Depend on an abstraction owned by \"domain\" instead of ...",
    "steps": [
      "Delete `from shop.infrastructure.sql_orders import SqlOrderRepository`. Do not move the import into a function or behind TYPE_CHECKING; Inwards checks those too.",
      "Declare a typing.Protocol in `shop.domain` (for example `shop.domain.ports`) ...",
      "Type this module against that Protocol and receive the implementation through a constructor ...",
      "Make the class in \"infrastructure\" satisfy the Protocol, and wire it in the composition root."
    ]
  }
}
```

The diagnostic comes from the working scaffold in this repository, run on a copy of `examples/clean-app` with one bad import added. Long strings are cut with `...` here. The real output has them in full.

<div class="grid cards" markdown>

-   :material-lightning-bolt:{ .lg .middle } __Fast enough for every edit__

    ---

    One file checks in about 25 ms including process start ([measured](06-Constraints-and-Quality.md#measurements)), so it can run after every agent edit.

-   :material-robot-outline:{ .lg .middle } __Written for agents__

    ---

    Every violation carries numbered repair steps. It also catches the usual dodges, like imports hidden in functions or `TYPE_CHECKING` blocks.

-   :material-package-variant-closed:{ .lg .middle } __One binary, no Python needed__

    ---

    A single executable compiled with Bun. Drop it in CI, a pre-commit hook or an agent hook.

-   :material-microsoft-visual-studio-code:{ .lg .middle } __Same rules in the editor__

    ---

    The VS Code extension runs the same engine through LSP, so the squiggle and the CI failure never disagree.

</div>

## What Inwards is not

It is not a general linter, a type checker or a formatter. Keep Ruff and ty. Inwards only reasons about the dependency structure between your own modules, and it assumes you already know what architecture you want. It won't invent one for you.

## How these docs are organised

The structure follows C4 for the architecture and plain ADRs for decisions.

| Chapter | Read it if you want to know |
|---|---|
| [2. Business context](02-Business-Context.md) | Who else is in this space, why Inwards should exist, and the hypothesis we're testing |
| [3. Architecture (C4)](03-Architecture-C4.md) | Context, containers and components, with diagrams |
| [4. AI integration](04-AI-Integration.md) | How Inwards plugs into Claude Code, Aider, Copilot and friends |
| [5. Decisions (ADR)](05-ADR.md) | Why TypeScript, why WASM tree-sitter, why Bun, and what we gave up |
| [6. Constraints and quality](06-Constraints-and-Quality.md) | Performance budgets, measurements, risks |
| [7. Glossary](07-Glossary.md) | The vocabulary, from "port" to "import skeleton" |

!!! info "Status"
    Pre-alpha (0.0.1). Two rules work end to end in the CLI, the engine and the VS Code server: INW001 (layer direction) and INW000 (a declared source encoding that could hide imports). `inwards hook claude-code` wires them into Claude Code, and each `v*` tag drafts a GitHub Release with binaries for six platforms. Everything marked :material-progress-clock: in these docs is planned, not built.
