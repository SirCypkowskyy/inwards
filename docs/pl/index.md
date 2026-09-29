---
source: docs/chapters/index.md
source_hash: dffb9bf402180ee3569e70030098d7d5a3f70a34840ae34438e635032e14e83d
template: home.html
hide:
  - navigation
  - toc
---

<div class="inw-hero" markdown>

# Inwards { #inwards }

Reguły architektury dla Pythona, na tyle szybkie, że można je uruchamiać po każdej edycji agenta AI.
{ .inw-lede }

Deklarujesz warstwy w `pyproject.toml`. Gdy import wskazuje w złą stronę, `inwards check` podaje linię i mówi agentowi, jak to naprawić.

<p class="inw-actions" markdown>
[Zacznij](guides/install.md){ .md-button .md-button--primary }
[Przeglądaj reguły](rules/index.md){ .md-button }
</p>

</div>

<figure class="inw-review">
<div class="inw-review__path"><span>shop/domain/order.py</span><span>1 dodana linia</span></div>
<pre class="inw-review__hunk" aria-label="shop/domain/order.py, linie od 3 do 6"><code><span class="inw-line inw-line--far"><span class="inw-ln">3</span>from __future__ import annotations</span><span class="inw-line inw-line--far"><span class="inw-ln">4</span></span><span class="inw-line"><span class="inw-ln">5</span>from dataclasses import dataclass</span><span class="inw-line inw-line--bad"><span class="inw-ln">6</span>from shop.infrastructure.in_memory_orders import <span class="inw-flag">InMemoryOrderRepository</span></span></code></pre>
<pre class="inw-review__out"><code><span class="inw-prompt">$ uv run inwards check shop/domain/order.py</span>
shop/domain/order.py:6:50: <b class="inw-code">INW001</b> Layer "domain" imports "shop.infrastructure.in_memory_orders.InMemoryOrderRepository" from outer layer "infrastructure". Allowed direction: domain &lt;- application &lt;- infrastructure &lt;- presentation &lt;- bootstrap.
  fix: Depend on an abstraction owned by "domain" instead of "shop.infrastructure.in_memory_orders.InMemoryOrderRepository".
    1. Delete `from shop.infrastructure.in_memory_orders import InMemoryOrderRepository`. Do not move the import into a function or behind TYPE_CHECKING; Inwards checks those too.
    2. Declare a typing.Protocol in `shop.domain` (for example `shop.domain.ports`) that describes only what this module needs from `InMemoryOrderRepository`.
    3. Type this module against that Protocol and receive the implementation through a constructor or function parameter.
    4. Make the class in "infrastructure" satisfy the Protocol, and wire it in the outermost layer (the composition root).
  docs: https://sircypkowskyy.github.io/inwards/rules/INW001/

Found 1 violation in 1 file (63.7 ms).</code></pre>
<figcaption>Prawdziwe uruchomienie Inwards 0.4.0 na przykładowym pakiecie z <code>inwards init --scaffold</code>, z jednym dodanym błędnym importem, 2026-09-29. Kod wyjścia 1.</figcaption>
</figure>

<div class="inw-premises" markdown>

<div class="inw-premise" markdown>

## Twoja architektura jako reguły { #your-architecture-as-rules }

`inwards init --style layered|clean|hexagonal` zapisuje warstwy w `pyproject.toml`, od najbardziej wewnętrznej. [INW001](rules/INW001.md) pilnuje kierunku, a każda diagnostyka ma kroki naprawy. [Konfiguracja](guides/configuration.md)

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

## Wbudowane w pętlę agenta { #built-into-the-agent-loop }

Sprawdzenie po każdej edycji, Stop gate nad wszystkim, co sesja zmieniła (także edycje przez Bash i commity), config guard, który odrzuca edycje reguł, i eskalacja do ciebie po [`escalate-after`](guides/configuration.md#escalate-after) próbach (domyślnie 3). [Jak działa pętla](04-AI-Integration.md#where-inwards-sits-in-the-agent-loop)

<div class="homepage-loop-wrap">
<svg id="homepage-loop" viewBox="0 0 820 160" role="img"
     aria-label="Agent edytuje plik, potem hook uruchamia inwards check. Przy naruszeniu agent dostaje kroki naprawy i wraca do edycji. Gdy jest czysto, agent pracuje dalej.">
  <defs>
    <marker id="hl-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="hl-arrowhead" />
    </marker>
  </defs>

  <path id="hl-edge-to-hook" class="hl-edge" marker-end="url(#hl-arrow)"
        d="M170,50 H330" />
  <path id="hl-edge-violation" class="hl-edge hl-edge-dashed" marker-end="url(#hl-arrow)"
        d="M400,70 C400,110 250,110 170,70" />
  <text class="hl-edge-label" x="285" y="122">naruszenie + kroki naprawy</text>
  <path id="hl-edge-clean" class="hl-edge" marker-end="url(#hl-arrow)"
        d="M480,50 H610" />
  <text class="hl-edge-label" x="545" y="40">czysto</text>

  <g id="hl-agent" class="hl-node" tabindex="0">
    <rect x="20" y="20" width="150" height="60" rx="6" />
    <text x="95" y="50">Agent edytuje plik</text>
  </g>

  <g id="hl-hook" class="hl-node hl-node--inwards" tabindex="0">
    <rect x="340" y="20" width="140" height="60" rx="6" />
    <text x="410" y="42">Hook uruchamia</text>
    <text x="410" y="60">inwards check</text>
  </g>

  <g id="hl-outcomes" class="hl-node hl-node--end">
    <rect x="620" y="20" width="180" height="60" rx="6" />
    <text x="710" y="50">Agent pracuje dalej</text>
  </g>
</svg>
</div>

</div>

<div class="inw-premise" markdown>

## Łapie to, co robią agenci { #catches-what-agents-do }

[Zmyślony moduł](04-AI-Integration.md#catching-hallucinated-modules) (INW010), import za `TYPE_CHECKING`, [import dynamiczny](rules/INW011.md) (INW011): jedno prawdziwe uruchomienie, jeden plik. Wyciszenie wymaga powodu ([INW009](rules/INW009.md)), a poluzowanie konfiguracji czy dopisanie naruszenia do baseline'u zostaje odrzucone. [Wszystkie uniki, które Inwards obsługuje](04-AI-Integration.md#stopping-the-agent-from-gaming-the-check)

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

## Na tyle szybkie, by działać po każdej edycji { #fast-enough-for-every-edit }

Od kompilacji do bajtkodu sprawdzenie jednego pliku, które uruchamia hook, mieści się w budżecie 100 ms dla p95, nawet dla pliku z 4482 liniami.

<figure class="inw-chart" markdown>
<table markdown>
<thead><tr><th scope="col">Sprawdzany plik</th><th scope="col">p95 czasu rzeczywistego, budżet 100 ms</th></tr></thead>
<tbody markdown>
<tr markdown><th scope="row" markdown="span">[saleor, jeden plik](06-Constraints-and-Quality.md#measurements)</th><td><span class="inw-track" style="--v: 30"><span class="inw-bar"></span><span class="inw-val">30 ms</span></span></td></tr>
<tr markdown><th scope="row" markdown="span">[Przykładowy pakiet ze scaffoldu](06-Constraints-and-Quality.md#spike-bytecode-and-minification)</th><td><span class="inw-track" style="--v: 39.5"><span class="inw-bar"></span><span class="inw-val">39.5 ms</span></span></td></tr>
<tr markdown><th scope="row" markdown="span">[polar, plik z 4482 liniami](06-Constraints-and-Quality.md#measurements)</th><td><span class="inw-track" style="--v: 90"><span class="inw-bar"></span><span class="inw-val inw-val--in">90 ms</span></span></td></tr>
</tbody>
</table>
<figcaption markdown="span">`inwards check <file>`, ze startem procesu, jeden wątek, zmierzone 2026-09-26. Pasek kończy się na budżecie 100 ms.</figcaption>
</figure>

Zimne pełne sprawdzenie czyta [syntetyczne repozytorium z 496 000 linii](06-Constraints-and-Quality.md#measurements) w około 0,4 s, a 848 000 linii saleora w około 1,8 s, na jednym rdzeniu. Prescan przeoczył [0 importów w 6543 plikach](06-Constraints-and-Quality.md#results) z pięciu serwisów open source.

</div>

<div class="inw-start" markdown>

## Szybki start { #quickstart }

1. Zainstaluj Inwards jako zależność deweloperską albo pobierz plik binarny według [instrukcji instalacji](guides/install.md#from-a-release).

    === "uv"

        ```sh
        uv add --dev inwards
        ```

    === "pip"

        ```sh
        pip install inwards
        ```

2. Zainstaluj hooki Claude Code. W nowym projekcie dodaj `--style clean --scaffold`, żeby dostać warstwy i przykładowy pakiet.

    === "uv"

        ```sh
        uv run inwards init --agent claude
        ```

    === "pip"

        ```sh
        inwards init --agent claude
        ```

3. Sprawdź cały projekt.

    === "uv"

        ```sh
        uv run inwards check
        ```

    === "pip"

        ```sh
        inwards check
        ```

Inni agenci: [OpenCode](guides/opencode.md), [Aider](guides/aider.md), a Codex, Cursor i pozostali przez [`AGENTS.md`](guides/agents-md.md).

</div>

<nav class="inw-entries" aria-label="Dokumentacja" markdown>

[Zacznij](guides/install.md)
: Zainstaluj, potem podłącz swojego agenta.

[Reguły](rules/index.md)
: Co wyłapuje każdy kod i jak to naprawić.

[Jak działa z agentami](04-AI-Integration.md)
: Hooki, Stop gate i config guard.

[Architektura i decyzje](03-Architecture-C4.md)
: Widoki C4 i [wszystkie decyzje](05-ADR.md).

</nav>

<p class="inw-status" markdown>Pre-alpha. Najnowsze wydanie: [0.4.0 na PyPI](https://pypi.org/project/inwards/).</p>
