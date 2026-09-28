---
source: docs/chapters/rules/FAPI002.md
source_hash: ec88dbef4b9c47782ed19926ca4ceebba294d4e8cd2c4c1a9266220ac504128d
type: rule
title: FAPI002 undocumented-error-response
description: Operacja ścieżki FastAPI deklaruje każdy kod błędu, który może zwrócić.
code: FAPI002
name: undocumented-error-response
severity: error
suppressible: true
autofix: false
status: planned
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/model.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 183]
---

# FAPI002 `undocumented-error-response`

!!! warning "Zarejestrowana, jeszcze niezaimplementowana"

    FAPI002 jest zarejestrowana, więc konfiguracja, supresje i SARIF już znają ten kod, ale reguła niczego jeszcze nie zgłasza. Jej sprawdzenia trafią w [#183](https://github.com/SirCypkowskyy/inwards/issues/183). Włączenie jej przez `extend-select = ["FAPI002"]` jest poprawne i do tego czasu niczego nie zmienia.

## Co będzie robić { #what-it-will-do }

Zgłosi operację ścieżki, która może zwrócić kod błędu niezadeklarowany w jej wpisie OpenAPI: `HTTPException` rzucony w endpoincie, w wywoływanej funkcji pomocniczej lub zależności, albo własny wyjątek, który handler aplikacji zamienia na kod statusu. Pełny projekt, razem z opcjami, jest w [#183](https://github.com/SirCypkowskyy/inwards/issues/183).

## Jak działa { #how-it-works }

FAPI002 należy do rodziny reguł FastAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)): jest opt-in i czyta wspólny model FastAPI (aplikacje, routery, operacje ścieżek, krawędzie `include_router` i handlery wyjątków, rozwiązywane między plikami bez importowania aplikacji). Nie zgłasza tego, co już zgłaszają reguły `FAST` Ruffa.

## Konfiguracja { #configuration }

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI002"]
```

Jak każda reguła, przyjmuje `modules` w `[tool.inwards.rules.undocumented-error-response]` ([tabele opcji](index.md#opt-in-rules)). Znalezisko będzie można wyciszyć w linii przez `# inwards: ignore[FAPI002] reason="..."`.
