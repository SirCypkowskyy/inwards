---
source: docs/chapters/index.md
source_hash: e47f89e38851d4f937f790bec3c7e0a0e05edc2aa4547b98ad21af7e417718eb
hide:
  - navigation
---

# :material-layers-triple: Inwards { #inwards }

**Reguły architektury dla Pythona, na tyle szybkie, że można je uruchamiać po każdej edycji agenta AI.**

Deklarujesz swoje warstwy w `pyproject.toml`. `inwards check` zgłasza błąd, gdy import wskazuje w złą stronę, i mówi agentowi dokładnie, jak to naprawić. Poniższe uruchomienie jest prawdziwe: to przykładowa aplikacja ze scaffoldu z jednym dodanym błędnym importem.

<figure markdown="span">
  ![inwards check zgłasza INW001 z krokami naprawy](../assets/screens/check-violation.svg){ loading=lazy }
  <figcaption>Prawdziwe uruchomienie na przykładowej aplikacji z jednym dodanym błędnym importem. Kod wyjścia 1 oznacza naruszenia.</figcaption>
</figure>

??? example "To samo uruchomienie jako zwykły tekst"

    ```console
    $ inwards check clean-app/shop/domain/order.py
    clean-app/shop/domain/order.py:14:44: INW001 Layer "domain" imports "shop.infrastructure.sql_orders.SqlOrderRepository" from outer layer "infrastructure". Allowed direction: domain <- application <- infrastructure <- interface.
      fix: Depend on an abstraction owned by "domain" instead of "shop.infrastructure.sql_orders.SqlOrderRepository".
        1. Delete `from shop.infrastructure.sql_orders import SqlOrderRepository`. Do not move the import into a function or behind TYPE_CHECKING; Inwards checks those too.
        2. Declare a typing.Protocol in `shop.domain` (for example `shop.domain.ports`) that describes only what this module needs from `SqlOrderRepository`.
        3. Type this module against that Protocol and receive the implementation through a constructor or function parameter.
        4. Make the class in "infrastructure" satisfy the Protocol, and wire it in the outermost layer (the composition root).
      docs: https://sircypkowskyy.github.io/inwards/03-Architecture-C4/#rule-catalogue

    Found 1 violation in 1 file (16.8 ms).
    ```

<div class="homepage-loop-wrap">
<svg id="homepage-loop" viewBox="0 0 820 160" role="img"
     aria-label="Agent edytuje plik, a potem hook uruchamia inwards check. Przy naruszeniu agent dostaje kroki naprawy i wraca do edycji. Gdy jest czysto, agent pracuje dalej.">
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
    <rect x="20" y="20" width="150" height="60" rx="10" />
    <text x="95" y="55">🤖 Agent edytuje plik</text>
  </g>

  <g id="hl-hook" class="hl-node" tabindex="0">
    <rect x="340" y="20" width="140" height="60" rx="10" />
    <text x="410" y="45">⚡ Hook uruchamia</text>
    <text x="410" y="62">inwards check</text>
  </g>

  <g id="hl-outcomes" class="hl-node">
    <rect x="620" y="20" width="180" height="60" rx="10" />
    <text x="710" y="55">✅ Agent pracuje dalej</text>
  </g>
</svg>
</div>

## Zacznij tutaj { #start-here }

<div class="grid cards" markdown>

-   :material-rocket-launch-outline:{ .lg .middle } __[Pierwsze kroki](guides/install.md)__

    ---

    Zainstaluj plik binarny albo wheel, a potem podłącz Inwards do Claude Code, Aidera albo dowolnego agenta, który czyta `AGENTS.md`.

-   :material-book-open-page-variant:{ .lg .middle } __[Wprowadzenie](01-Introduction.md)__

    ---

    Problem, co Inwards z nim robi i czego celowo nie robi.

-   :material-chart-timeline-variant:{ .lg .middle } __[Kontekst biznesowy](02-Business-Context.md)__

    ---

    Ruff, ty, Biome, React Doctor, import-linter i spółka, luka między nimi oraz hipoteza, którą testujemy.

-   :material-sitemap-outline:{ .lg .middle } __[Architektura (C4)](03-Architecture-C4.md)__

    ---

    Kontekst, kontenery, komponenty, przebieg sprawdzenia i katalog reguł.

-   :material-robot-happy-outline:{ .lg .middle } __[Integracja z AI](04-AI-Integration.md)__

    ---

    Hooki dla Claude Code, Aidera, Copilota i innych oraz to, jak Inwards nie pozwala agentom oszukiwać sprawdzenia.

-   :material-scale-balance:{ .lg .middle } __[Decyzje (ADR)](05-ADR.md)__

    ---

    Wszystkie decyzje architektoniczne, między innymi „dlaczego TypeScript”, „jak powstaje wydanie” i „jak wybiera się pakiety”.

-   :material-speedometer:{ .lg .middle } __[Ograniczenia i jakość](06-Constraints-and-Quality.md)__

    ---

    Budżety, zmierzone liczby i ryzyka, które obserwujemy.

</div>

[Słownik](07-Glossary.md) definiuje każdy termin, od „portu” po „szkielet importów”.

!!! info "Stan projektu"
    Pre-alpha.
    Siedem reguł działa od początku do końca w CLI, w silniku i w serwerze VS Code: INW001 (kierunek warstw), INW011 (dosłowne importy dynamiczne), INW005 ([biblioteki w warstwach](guides/libraries.md): domyślnie żadnych frameworków ani operacji wejścia-wyjścia w domenie), INW006 (kod poza wszystkimi warstwami, martwe prefiksy), INW007 i INW008 ([kształt pakietu](guides/package-shape.md): elementy dozwolone, zabronione i wymagane) oraz INW000 (zadeklarowane kodowanie źródła, które mogłoby ukryć importy).
    `inwards init --agent claude` instaluje hooki Claude Code: sprawdzenie po każdej edycji, Stop gate obejmujący to, co zmieniła sesja, config guard oraz eskalację do użytkownika. Dla Aidera `init` wypisuje linię `lint-cmd` do dodania, a dla innych agentów zapisuje sekcję w `AGENTS.md`. W nowym projekcie `inwards init --style layered|clean|hexagonal` zapisuje warstwy, a `--scaffold` dodaje przykładowy pakiet, który przechodzi sprawdzenie.
    Każde wydanie to GitHub Release z plikami binarnymi dla sześciu platform, pięcioma wheelami platformowymi dla `uv add` i plikiem `.vsix`. Jak dotąd jedynym wydaniem jest wersja przedpremierowa v0.1.0-rc.1.
    CI testuje każdy pull request na Linuksie, a na macOS i Windows – przed każdym wydaniem. Elementy oznaczone :material-progress-clock: są zaplanowane.
