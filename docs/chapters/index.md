---
template: home.html
hide:
  - navigation
  - toc
  - footer
---

<div class="inw-hero" markdown>

# <span class="inw-sr-only">Inwards: </span>Architecture rules for Python, fast enough to run after every edit an AI agent makes. { #inwards .inw-lede }

You declare the layers in `pyproject.toml`. When an import points the wrong way, `inwards check` names the line and tells the agent how to fix it.

<p class="inw-actions" markdown>
[Get started](guides/install.md){ .md-button .md-button--primary }
[Browse the rules](rules/index.md){ .md-button }
</p>

</div>

<figure class="inw-review">
<div class="inw-review__path"><span>shop/domain/order.py</span><span>1 line added</span></div>
<pre class="inw-review__hunk" aria-label="shop/domain/order.py, lines 3 to 6"><code><span class="inw-line inw-line--far"><span class="inw-ln">3</span>from __future__ import annotations</span><span class="inw-line inw-line--far"><span class="inw-ln">4</span></span><span class="inw-line"><span class="inw-ln">5</span>from dataclasses import dataclass</span><span class="inw-line inw-line--bad"><span class="inw-ln">6</span>from shop.infrastructure.in_memory_orders import <span class="inw-flag">InMemoryOrderRepository</span></span></code></pre>
<pre class="inw-review__out"><code><span class="inw-prompt">$ uv run inwards check shop/domain/order.py</span>
shop/domain/order.py:6:50: <b class="inw-code">INW001</b> Layer "domain" imports "shop.infrastructure.in_memory_orders.InMemoryOrderRepository" from outer layer "infrastructure". Allowed direction: domain &lt;- application &lt;- infrastructure &lt;- presentation &lt;- bootstrap.
  fix: Depend on an abstraction owned by "domain" instead of "shop.infrastructure.in_memory_orders.InMemoryOrderRepository".
    1. Delete `from shop.infrastructure.in_memory_orders import InMemoryOrderRepository`. Do not move the import into a function or behind TYPE_CHECKING; Inwards checks those too.
    2. Declare a typing.Protocol in `shop.domain` (for example `shop.domain.ports`) that describes only what this module needs from `InMemoryOrderRepository`.
    3. Type this module against that Protocol and receive the implementation through a constructor or function parameter.
    4. Make the class in "infrastructure" satisfy the Protocol, and wire it in the outermost layer (the composition root).
  docs: https://sircypkowskyy.github.io/inwards/rules/INW001/

Found 1 violation in 1 file (63.7 ms).</code></pre>
<figcaption>A real run of Inwards 0.4.0 on the scaffold's example app, 2026-09-29.</figcaption>
</figure>

<div class="inw-premises" markdown>

<div class="inw-premise" markdown>

## Your architecture, as rules

[Layers](guides/configuration.md) go in `pyproject.toml`, innermost first. [INW001](rules/INW001.md) enforces the direction; every diagnostic carries fix steps.

```toml
[tool.inwards]
root = "."
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
  { name = "presentation", modules = ["shop.presentation"] },
  { name = "bootstrap", modules = ["shop.bootstrap"] },
]
```

</div>

<div class="inw-premise" markdown>

## Built into the agent loop

[A check after each edit](04-AI-Integration.md#where-inwards-sits-in-the-agent-loop), a Stop gate over the whole session (Bash edits too), a config guard on the rules, and escalation to you after [`escalate-after`](guides/configuration.md#escalate-after) tries.

<div class="homepage-loop-wrap">
<svg id="homepage-loop" viewBox="0 0 380 290" role="img"
     aria-label="Agent edits a file, then the hook runs inwards check. On a violation, the agent gets fix steps and loops back. When clean, the agent continues.">
  <defs>
    <marker id="hl-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="hl-arrowhead" />
    </marker>
  </defs>

  <path id="hl-edge-to-hook" class="hl-edge" marker-end="url(#hl-arrow)"
        d="M95,60 V112" />
  <path id="hl-edge-violation" class="hl-edge hl-edge-dashed" marker-end="url(#hl-arrow)"
        d="M180,148 C262,148 262,35 188,35" />
  <text class="hl-edge-label hl-edge-label--side" x="252" y="86">violation</text>
  <text class="hl-edge-label hl-edge-label--side" x="252" y="104">+ fix steps</text>
  <path id="hl-edge-clean" class="hl-edge" marker-end="url(#hl-arrow)"
        d="M95,176 V222" />
  <text class="hl-edge-label hl-edge-label--side" x="105" y="203">clean</text>

  <g id="hl-agent" class="hl-node" tabindex="0">
    <rect x="10" y="10" width="170" height="50" rx="6" />
    <text x="95" y="35">Agent edits a file</text>
  </g>

  <g id="hl-hook" class="hl-node hl-node--inwards" tabindex="0">
    <rect x="10" y="120" width="170" height="56" rx="6" />
    <text x="95" y="139">Hook runs</text>
    <text x="95" y="158">inwards check</text>
  </g>

  <g id="hl-outcomes" class="hl-node hl-node--end">
    <rect x="10" y="230" width="170" height="50" rx="6" />
    <text x="95" y="255">Agent continues</text>
  </g>
</svg>
</div>

</div>

<div class="inw-premise" markdown>

## Catches what agents do

[Hallucinated modules](04-AI-Integration.md#catching-hallucinated-modules), imports behind `TYPE_CHECKING`, [dynamic imports](rules/INW011.md). Suppressions need a reason ([INW009](rules/INW009.md)); [loosening the config is refused](04-AI-Integration.md#stopping-the-agent-from-gaming-the-check).

```console
$ uv run inwards check shop/domain/dodge.py --format concise
shop/domain/dodge.py:8:33: INW010 "shop.domain.pricing" is not a module of this project: "shop.domain" has no "pricing". fix: Check the name. The closest modules in "shop.domain": `shop.domain.order`.
shop/domain/dodge.py:11:54: INW001 Layer "domain" imports "shop.infrastructure.in_memory_orders.InMemoryOrderRepository" from outer layer "infrastructure". Allowed direction: domain <- application <- infrastructure <- presentation <- bootstrap. fix: Delete `from shop.infrastructure.in_memory_orders import InMemoryOrderRepository`. Do not move the import into a function or behind TYPE_CHECKING; Inwards checks those too.
shop/domain/dodge.py:15:12: INW011 Layer "domain" imports "shop.infrastructure.in_memory_orders" from outer layer "infrastructure" through a dynamic import (importlib.import_module). Allowed direction: domain <- application <- infrastructure <- presentation <- bootstrap. fix: Delete `importlib.import_module("shop.infrastructure.in_memory_orders")`. A dynamic import is still a dependency: building the module name at runtime or moving it to another loader hides it instead of removing it.
Found 3 violations in 1 file (109.4 ms).
```

</div>

</div>

<div class="inw-speed" markdown>

## Fast enough for every edit

The one-file check a hook runs stays under its 100 ms p95 budget, even on a 4,482-line file.

<figure class="inw-chart" markdown>
<table markdown>
<thead><tr><th scope="col">File</th><th scope="col">p95, of 100 ms</th></tr></thead>
<tbody markdown>
<tr markdown><th scope="row" markdown="span">[saleor, one file](06-Constraints-and-Quality.md#measurements)</th><td><span class="inw-track" style="--v: 30"><span class="inw-bar"></span><span class="inw-val">30 ms</span></span></td></tr>
<tr markdown><th scope="row" markdown="span">[The scaffold's example app](06-Constraints-and-Quality.md#spike-bytecode-and-minification)</th><td><span class="inw-track" style="--v: 39.5"><span class="inw-bar"></span><span class="inw-val">39.5 ms</span></span></td></tr>
<tr markdown><th scope="row" markdown="span">[polar, a 4,482-line file](06-Constraints-and-Quality.md#measurements)</th><td><span class="inw-track" style="--v: 90"><span class="inw-bar"></span><span class="inw-val inw-val--in">90 ms</span></span></td></tr>
</tbody>
</table>
<figcaption markdown="span">`inwards check <file>` with process start, one thread, 2026-09-26.</figcaption>
</figure>

Cold full check, one core: [496,000 lines in 0.4 s](06-Constraints-and-Quality.md#measurements), saleor's 848,000 in 1.8 s. Prescan misses: [0 in 6,543 files](06-Constraints-and-Quality.md#results).

</div>

<div class="inw-start" markdown>

## Quickstart

1. Install it, or [take a binary](guides/install.md#from-a-release).

    === "uv"

        ```sh
        uv add --dev inwards
        ```

    === "pip"

        ```sh
        pip install inwards
        ```

2. Add the Claude Code hooks. New project? Add `--style clean --scaffold`.

    === "uv"

        ```sh
        uv run inwards init --agent claude
        ```

    === "pip"

        ```sh
        inwards init --agent claude
        ```

3. Check the project.

    === "uv"

        ```sh
        uv run inwards check
        ```

    === "pip"

        ```sh
        inwards check
        ```

Other agents: [OpenCode](guides/opencode.md), [Aider](guides/aider.md), [`AGENTS.md`](guides/agents-md.md).

</div>

<nav class="inw-entries" aria-label="Documentation" markdown>

[Get started](guides/install.md)
: Install and connect your agent.

[Rules](rules/index.md)
: Each code and its fix.

[How it works with agents](04-AI-Integration.md)
: Hooks and the Stop gate.

[Architecture and decisions](03-Architecture-C4.md)
: C4 views and [decisions](05-ADR.md).

</nav>

<p class="inw-status" markdown>Pre-alpha. Latest release: [0.4.0 on PyPI](https://pypi.org/project/inwards/).</p>
