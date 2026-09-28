---
source: docs/chapters/rules/FAPI001.md
source_hash: 26896d93c90b568c054dad66149942210fcd849ce1637d00b57075e93589224b
type: rule
title: FAPI001 endpoint-metadata
description: Operacja ścieżki FastAPI deklaruje metadane OpenAPI, których wymaga projekt.
code: FAPI001
name: endpoint-metadata
severity: error
suppressible: true
autofix: false
status: planned
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/model.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 183]
---

# FAPI001 `endpoint-metadata`

!!! warning "Zarejestrowana, jeszcze niezaimplementowana"

    FAPI001 jest zarejestrowana, więc konfiguracja, supresje i SARIF już znają ten kod, ale reguła niczego jeszcze nie zgłasza. Jej sprawdzenia trafią w [#183](https://github.com/SirCypkowskyy/inwards/issues/183). Włączenie jej przez `extend-select = ["FAPI001"]` jest poprawne i do tego czasu niczego nie zmienia.

## Co będzie robić { #what-it-will-do }

Zgłosi operację ścieżki bez metadanych OpenAPI, których wymaga projekt: podsumowania lub docstringu, modelu odpowiedzi, jawnego kodu statusu dla `POST` i `DELETE`, opisu każdego wpisu w `responses=`, a po włączeniu także tagów i `operation_id`. Pełny projekt, razem z opcjami, jest w [#183](https://github.com/SirCypkowskyy/inwards/issues/183).

## Jak działa { #how-it-works }

FAPI001 należy do rodziny reguł FastAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)): jest opt-in i czyta wspólny model FastAPI (aplikacje, routery, operacje ścieżek, krawędzie `include_router` i handlery wyjątków, rozwiązywane między plikami bez importowania aplikacji). Nie zgłasza tego, co już zgłaszają reguły `FAST` Ruffa.

## Konfiguracja { #configuration }

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI001"]
```

Jak każda reguła, przyjmuje `modules` w `[tool.inwards.rules.endpoint-metadata]` ([tabele opcji](index.md#opt-in-rules)). Znalezisko będzie można wyciszyć w linii przez `# inwards: ignore[FAPI001] reason="..."`.
