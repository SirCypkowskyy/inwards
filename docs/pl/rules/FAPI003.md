---
source: docs/chapters/rules/FAPI003.md
source_hash: 63d6bca0107aff60835a90a87bf301f255ea0f39170b4047f105af14ad324f95
type: rule
title: FAPI003 router-wiring
description: Każdy APIRouter z trasami jest dołączony do aplikacji, a routery nie dołączają się nawzajem w cyklu.
code: FAPI003
name: router-wiring
severity: error
suppressible: true
autofix: false
status: planned
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/model.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 184]
---

# FAPI003 `router-wiring`

!!! warning "Zarejestrowana, jeszcze niezaimplementowana"

    FAPI003 jest zarejestrowana, więc konfiguracja, supresje i SARIF już znają ten kod, ale reguła niczego jeszcze nie zgłasza. Jej sprawdzenia trafią w [#184](https://github.com/SirCypkowskyy/inwards/issues/184). Włączenie jej przez `extend-select = ["FAPI003"]` jest poprawne i do tego czasu niczego nie zmienia.

## Co będzie robić { #what-it-will-do }

Zgłosi `APIRouter` z trasami, do którego żadna aplikacja nie dochodzi przez `include_router`, routery dołączające się nawzajem w cyklu oraz wywołanie `include_router` przed zadeklarowaniem tras dołączanego routera. Pełny projekt, razem z opcjami, jest w [#184](https://github.com/SirCypkowskyy/inwards/issues/184).

## Jak działa { #how-it-works }

FAPI003 należy do rodziny reguł FastAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)): jest opt-in i czyta wspólny model FastAPI (aplikacje, routery, operacje ścieżek, krawędzie `include_router` i handlery wyjątków, rozwiązywane między plikami bez importowania aplikacji). Nie zgłasza tego, co już zgłaszają reguły `FAST` Ruffa.

## Konfiguracja { #configuration }

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI003"]
```

Jak każda reguła, przyjmuje `modules` w `[tool.inwards.rules.router-wiring]` ([tabele opcji](index.md#opt-in-rules)). Znalezisko będzie można wyciszyć w linii przez `# inwards: ignore[FAPI003] reason="..."`.
