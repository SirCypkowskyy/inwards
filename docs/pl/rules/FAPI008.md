---
source: docs/chapters/rules/FAPI008.md
source_hash: fb91f7eede5ef47a3c0baf4dfb851680bc1f03ff404c61c68adab5a4ed0d04ff
type: rule
title: FAPI008 duplicate-operation-id
description: Żadne dwie operacje ścieżki jednej aplikacji FastAPI nie mają tego samego jawnego operation_id, więc wygenerowani klienci dostają jedną metodę na operację.
code: FAPI008
name: duplicate-operation-id
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/duplicate-operation-id.ts
timestamp: 2026-10-09T18:00:00Z
related_issues: [186, 184, 227]
---

# FAPI008 `duplicate-operation-id`

## Co robi { #what-it-does }

Opt-in. Zgłasza operację ścieżki, której literalne `operation_id=` ma już wcześniejsza operacja tej samej aplikacji. Każda operacja, do której dochodzi aplikacja, jest grupowana według swojego id, także między routerami, które aplikacja dołącza; każda kolejna po pierwszej jest zgłaszana na swoim dekoratorze, a komunikat wskazuje pierwszą wraz z plikiem i linią.

To samo id w operacjach dwóch różnych aplikacji jest w porządku: schemat OpenAPI aplikacji zawiera tylko jej własne operacje.

## Dlaczego to źle { #why-is-this-bad }

Generator klienta zamienia każde `operationId` w nazwę metody. Dwie operacje z jednym id dają dwie metody o jednej nazwie, a generator albo się wysypuje, albo zostawia jedną z nich. FastAPI loguje "Duplicate Operation ID" dopiero przy budowie schematu w czasie działania, czego test, który nigdy nie pobiera `/openapi.json`, nie robi. Ruff sprawdza jeden plik naraz i nie ma na to reguły.

## Przykład { #example }

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI008"]
```

<!-- e2e -->

```python title="app/users.py"
from fastapi import APIRouter

router = APIRouter()


@router.get("/", operation_id="list_items")
async def list_users() -> list[str]:
    return []
```

<!-- e2e -->

```python title="app/orders.py"
from fastapi import APIRouter

router = APIRouter()


@router.get("/", operation_id="list_items")
async def list_orders() -> list[str]:
    return []
```

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app import orders, users

app = FastAPI()
app.include_router(users.router, prefix="/users")
app.include_router(orders.router, prefix="/orders")
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/orders.py:6:1: FAPI008 `@router.get("/")` uses operation_id "list_items", which `@router.get("/")` at app/users.py:6 already uses: a generated client gets two methods with one name, and FastAPI only warns when it builds the schema.
  fix: Give each operation its own operation_id.
    1. Rename the operation_id of this one, or of `@router.get("/")` at app/users.py:6, so no two operations of the app share one.
    2. If the ids should come from the function names, drop the explicit operation_id= and set generate_unique_id_function on the app instead.
    3. Don't change an id a published client already uses without telling the user: it renames the client's method.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI008/
```

Poprawione: każda operacja ma własne id.

<!-- e2e -->

```python title="app/orders.py"
from fastapi import APIRouter

router = APIRouter()


@router.get("/", operation_id="list_orders")
async def list_orders() -> list[str]:
    return []
```

<!-- e2e -->

```sh
inwards check app
```

## Jak działa { #how-it-works }

FAPI008 czyta wspólny model FastAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)) oraz graf aplikacji i routerów z [FAPI003](FAPI003.md), czyli te same listy tras co [FAPI005](FAPI005.md). Dla każdej aplikacji i dla każdego routera, którego nie dołącza żadna znana aplikacja ani router, układa operacje w kolejności, w jakiej trzyma je FastAPI, z operacjami dołączonego routera w miejscu dołączenia. Pierwsza operacja z danym id je zachowuje; późniejsza z tym samym id jest zgłaszana, raz, nawet gdy dochodzi do niej kilka aplikacji lub dołączeń.

Jawne `operation_id=` przesłania `generate_unique_id_function`, więc funkcja na aplikacji lub routerze niczego tu nie zmienia: porównywane są tylko jawne id.

Gdzie działa:

- **`inwards check`**, `inwards baseline` i **Stop gate** zgłaszają oba rodzaje, w obrębie routera i między routerami, w plikach, które sprawdzają.
- **Hook PostToolUse** i edytor zgłaszają tylko to, co widać w jednym routerze w jednym pliku. Podpięcie routerów do aplikacji to druga edycja, więc zgłoszenia między routerami czekają na Stop gate. Wyciszenie zgłoszenia między routerami nadal liczy się w hooku jako użyte.

## Jak naprawić { #how-to-fix }

1. Nadaj jednej z dwóch operacji inne `operation_id`, unikalne w aplikacji.
2. Albo usuń jawne id i pozwól `generate_unique_id_function` zbudować je z trasy.
3. Zanim zmienisz id, sprawdź, czy używa go już opublikowany klient: zmiana zmienia nazwę metody klienta.

## Bezpieczeństwo poprawki { #fix-safety }

Brak automatycznej poprawki (`autofix: false`). Która z dwóch zachowa nazwę i czy zależy od niej klient, to decyzje autora.

## Konfiguracja { #configuration }

Waga: błąd. Opt-in: włącz przez `extend-select`. Nie ma własnych opcji; `modules` działa jak w każdej regule ([tabele opcji](index.md#opt-in-rules)).

Każde zgłoszenie stoi na dekoratorze i można je wyciszyć w kodzie przez `# inwards: ignore[FAPI008] reason="..."` w tej linii.

## Znane ograniczenia { #known-limitations }

Nieznane oznacza ciszę. Nic nie jest zgłaszane, gdy:

- `operation_id=` nie jest literałem tekstowym (zmienna, f-string, wywołanie) albo `**kwargs` może je ukrywać;
- operacja ma literalne `include_in_schema=False`, bo nie ma jej w schemacie;
- dołączenia aplikacji nie da się śledzić, więc router nie jest osiągalny z aplikacji, którą zna Inwards.

Dalsze ograniczenia:

- **Ta sama operacja osiągnięta dwa razy** (router, który jedna aplikacja dołącza pod dwoma prefiksami) dzieli id sama ze sobą i nie jest zgłaszana; FastAPI by ostrzegł.
- **Kolejność między plikami**: router trzymający trasy w kilku plikach nie ma znanej kolejności, więc to, która operacja jest pierwsza, jest tylko konwencją (ścieżka pliku, potem pozycja).
- **`mount`** nie jest śledzony: zamontowana aplikacja ma własny schemat.
- **Trasy dodawane w czasie działania** (`app.add_api_route(...)`) nie są widoczne.

## Źródła { #references }

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): rodzina FastAPI, opt-in, i wspólny model.
- Dokumentacja FastAPI, [Path Operation Advanced Configuration](https://fastapi.tiangolo.com/advanced/path-operation-advanced-configuration/#openapi-operationid): "OpenAPI operationId".
