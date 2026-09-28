---
source: docs/chapters/rules/FAPI008.md
source_hash: d087561591873ff50489958c538f4649c5579bdec08554402da233757df41e12
type: rule
title: FAPI008 duplicate-operation-id
description: Żadne dwie operacje ścieżki obsługiwane przez jedną aplikację FastAPI nie mają tego samego jawnego operation_id.
code: FAPI008
name: duplicate-operation-id
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/duplicate-operation-id.ts
timestamp: 2026-09-28T22:00:00Z
related_issues: [186, 184, 227]
---

# FAPI008 `duplicate-operation-id`

## Co robi { #what-it-does }

Opt-in. Zgłasza operację ścieżki, której jawne `operation_id=` ma już inna operacja ścieżki tej samej aplikacji. Operacje każdej aplikacji są zbierane przez graf [FAPI003](FAPI003.md), między routerami i plikami, w kolejności, w jakiej aplikacja je obsługuje; pierwsza zachowuje identyfikator, a każda późniejsza jest zgłaszana na swoim dekoratorze, ze wskazaniem pierwszej. Poprawka podaje plik i linię pierwszej.

## Dlaczego to źle { #why-is-this-bad }

Specyfikacja OpenAPI wymaga, żeby każde `operationId` było unikalne. Generatory klientów (openapi-generator, orval, openapi-ts) zamieniają każdy identyfikator na nazwę metody, więc dwie operacje z jednym identyfikatorem dają dwie metody o jednej nazwie: generator kończy się błędem, zmienia nazwę jednej (`getOrder1`) albo jedna nadpisuje drugą. FastAPI i tak buduje schemat i tylko loguje ostrzeżenie `Duplicate Operation ID` przy pierwszym żądaniu `/openapi.json`, w czasie działania. Obie operacje zwykle są w różnych routerach, często w różnych plikach, więc przegląd kodu rzadko to wyłapuje, a Ruff sprawdza jeden plik naraz.

## Przykład { #example }

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI008"]
```

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app import legacy, orders

app = FastAPI()
app.include_router(orders.router, prefix="/orders")
app.include_router(legacy.router, prefix="/v1/orders")
```

<!-- e2e -->

```python title="app/orders.py"
from fastapi import APIRouter

router = APIRouter(tags=["orders"])


@router.get("/{order_id}", operation_id="getOrder")
async def get_order(order_id: int) -> dict[str, int]:
    return {"id": order_id}
```

<!-- e2e -->

```python title="app/legacy.py"
from fastapi import APIRouter

router = APIRouter(tags=["legacy"])


@router.get("/{order_id}", operation_id="getOrder")
async def get_legacy_order(order_id: int) -> dict[str, int]:
    return {"id": order_id}
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/legacy.py:6:1: FAPI008 `get_legacy_order` has operation_id "getOrder", which `get_order` already has in the app `app.main.app`. OpenAPI needs each id once, and a generated client gets two methods with one name.
  fix: Give `get_legacy_order` an operation_id of its own; `get_order` (app/orders.py:6) keeps "getOrder".
    1. Rename the id that fits its endpoint worse, and update the client code or tests that call it by that name.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI008/
```

Po poprawce: endpoint legacy dostaje własny identyfikator.

<!-- e2e -->

```python title="app/legacy.py"
from fastapi import APIRouter

router = APIRouter(tags=["legacy"])


@router.get("/{order_id}", operation_id="getLegacyOrder")
async def get_legacy_order(order_id: int) -> dict[str, int]:
    return {"id": order_id}
```

<!-- e2e -->

```sh
inwards check app
```

## Jak działa { #how-it-works }

FAPI008 czyta wspólny model FastAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)) i przechodzi trasy każdej aplikacji przez graf FAPI003, tak samo jak [FAPI005](FAPI005.md).

- **Na aplikację.** Operacje są grupowane po `operation_id` w obrębie jednej aplikacji. Dwie aplikacje mają dwa schematy, więc ten sam identyfikator na operacjach dwóch różnych aplikacji jest w porządku, a router dołączony przez dwie aplikacje jest sprawdzany w każdej.
- **Tylko jawne identyfikatory będące literałami.** Liczy się tylko `operation_id="..."` jako literał tekstowy. Identyfikator, który generuje FastAPI, z nazwy funkcji, ścieżki i metody albo z `generate_unique_id_function` na aplikacji, routerze albo `include_router`, nie jest czytany: jawny identyfikator zawsze wygrywa z funkcją, więc tylko jawne identyfikatory Inwards może porównać. Identyfikator niebędący literałem (`operation_id=ids.GET_ORDER`, f-string) jest pomijany.
- **Tylko w schemacie.** Operacja pominięta w schemacie przez `include_in_schema=False` na dekoratorze, jej routerze albo `include_router` nad nią nie liczy się, bo FastAPI nie umieszcza jej w `/openapi.json`.
- **Raz na operację.** Operacja, która koliduje w dwóch aplikacjach, jest zgłaszana raz.

Gdzie działa:

- **`inwards check`**, `inwards baseline` i **Stop gate** zgłaszają ją w plikach, które sprawdzają, względem grafu całego projektu.
- **Hook PostToolUse** i edytor jej nie zgłaszają: to, czy dwie operacje trafią do jednej aplikacji, zależy od tego, jak aplikacja dołącza ich routery, czego jedna edycja nie pokazuje. Wyciszenie nadal liczy się tam jako użyte.

## Jak naprawić { #how-to-fix }

1. Daj zgłoszonej operacji własne `operation_id`. Zostaw identyfikator na operacji, którą klienci już wywołują pod tą nazwą.
2. Zaktualizuj kod klienta i testy, które wywołują przemianowaną operację po identyfikatorze.

## Bezpieczeństwo poprawki { #fix-safety }

Brak automatycznej poprawki (`autofix: false`). Zmiana identyfikatora zmienia nazwę metody w każdym wygenerowanym kliencie, więc o tym, który się zmienia, decyduje zespół.

## Konfiguracja { #configuration }

Ważność: błąd. Opt-in: włącza się ją przez `extend-select`. Nie ma własnych opcji; `[tool.inwards.rules.duplicate-operation-id]` przyjmuje `modules`, jak każda reguła ([tabele opcji](index.md#opt-in-rules)).

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI008"]
```

Każda diagnostyka jest na dekoratorze późniejszej operacji i można ją wyciszyć w linii przez `# inwards: ignore[FAPI008] reason="..."` w tej linii.

## Znane ograniczenia { #known-limitations }

- **Wygenerowane identyfikatory nie są porównywane.** Dwie operacje bez jawnego identyfikatora mogą nadal kolidować przy własnej `generate_unique_id_function`; Inwards nie uruchamia tej funkcji.
- **Router dołączony dwa razy** (pod `/v1` i `/v2`) daje każdy swój jawny identyfikator dwa razy. Nie jest to zgłaszane, bo diagnostyka byłaby na jednym dekoratorze, który obie kopie dzielą; pokrywa to własne ostrzeżenie FastAPI.
- **Dynamiczne podpinanie** (router, którego Inwards nie umie rozwiązać) zostawia jego operacje poza aplikacją, jak opisuje FAPI003, więc kolizja z nimi umyka.
- **Kolejność między plikami** wynika z przejścia opisanego przy FAPI005: to, która z dwóch kolidujących operacji jest pierwsza, może się różnić od czasu działania, gdy trasa jest zadeklarowana w innym module niż ten, który tworzy jej router.

## Źródła { #references }

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): rodzina FastAPI, opt-in i wspólny model.
- [FAPI003](FAPI003.md): graf aplikacji i routerów, który przechodzi sprawdzenie.
- Specyfikacja OpenAPI, [Operation Object](https://spec.openapis.org/oas/v3.1.0#operation-object): `operationId` jest unikalne wśród wszystkich operacji.
- Dokumentacja FastAPI, [Path Operation Advanced Configuration](https://fastapi.tiangolo.com/advanced/path-operation-advanced-configuration/) i [Generate Clients](https://fastapi.tiangolo.com/advanced/generate-clients/).
