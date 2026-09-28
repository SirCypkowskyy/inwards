---
source: docs/chapters/rules/FAPI005.md
source_hash: 7e831458fd24a579d191f8a47f76598866cfa4f90ceca9656d747c53c82406de
type: rule
title: FAPI005 route-shadowing
description: Żadna operacja ścieżki FastAPI nie jest nieosiągalna za wcześniejszą trasą z tą samą metodą, która pasuje do jej ścieżki.
code: FAPI005
name: route-shadowing
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/route-shadowing.ts
timestamp: 2026-09-28T22:00:00Z
related_issues: [186, 184, 224]
---

# FAPI005 `route-shadowing`

## Co robi { #what-it-does }

Opt-in. Zgłasza operację ścieżki, która nigdy się nie wykona, bo trasa przed nią z tą samą metodą pasuje do każdego żądania, które trafiłoby do niej:

- **Przesłonięta:** `@router.get("/users/{user_id}")` nad `@router.get("/users/me")`. `/users/me` najpierw pasuje do `{user_id}`, więc `read_me` nigdy nie jest wywoływana.
- **Duplikat:** ta sama metoda i ścieżka zadeklarowane dwa razy. Wykonuje się tylko pierwsza.

Oba przypadki są sprawdzane na jednym routerze w jednym pliku oraz między routerami, na pełnej ścieżce, którą obsługuje aplikacja: połączonych `prefix=` każdego `include_router` i `APIRouter(...)` po drodze. Diagnostyka jest na dekoratorze trasy, która się nie wykona, i wskazuje wcześniejszą trasę; poprawka podaje jej plik i linię.

## Dlaczego to źle { #why-is-this-bad }

FastAPI sprawdza trasy w kolejności deklaracji i dołączenia, bierze pierwsze dopasowanie i nie mówi nic o pozostałych. Samouczek FastAPI wspomina o tym w części „Order matters”. Przesłonięty endpoint nadal jest w schemacie OpenAPI i w swoich testach jednostkowych wywołujących funkcję, więc nic nie zawodzi, dopóki klient go nie wywoła i nie dostanie odpowiedzi innego endpointu, często 422, bo `me` nie jest `int`. Ruff sprawdza jeden plik naraz i nie ma na to reguły.

## Przykład { #example }

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI005"]
```

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app import admin, users

app = FastAPI()
app.include_router(users.router, prefix="/users")
app.include_router(admin.router, prefix="/users")
```

<!-- e2e -->

```python title="app/users.py"
from fastapi import APIRouter

router = APIRouter(tags=["users"])


@router.get("/{user_id}")
async def read_user(user_id: int) -> dict[str, int]:
    return {"id": user_id}


@router.get("/me")
async def read_me() -> dict[str, str]:
    return {"name": "me"}
```

<!-- e2e -->

```python title="app/admin.py"
from fastapi import APIRouter

router = APIRouter(tags=["admin"])


@router.get("/stats")
async def user_stats() -> dict[str, int]:
    return {"users": 0}
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/admin.py:6:1: FAPI005 `user_stats` (GET /users/stats) never runs: `read_user` (GET /users/{user_id}) comes before it and matches the same requests, and FastAPI uses the first route that matches.
  fix: Include the router that declares `user_stats` before the one that declares `read_user` (app/users.py:6), or give one of them another path.
    1. FastAPI tries routes in the order they are declared and included: a literal path such as /users/me must come before a parameter path such as /users/{user_id}.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI005/

app/users.py:11:1: FAPI005 `read_me` (GET /me) never runs: `read_user` (GET /{user_id}) comes before it and matches the same requests, and FastAPI uses the first route that matches.
  fix: Move `read_me` above `read_user` (app/users.py:6), so the more specific path is tried first.
    1. FastAPI tries routes in the order they are declared and included: a literal path such as /users/me must come before a parameter path such as /users/{user_id}.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI005/
```

Pierwsza diagnostyka wymaga obu plików: `/users/stats` jest przesłonięta tylko dlatego, że oba routery są dołączone pod `/users`. Druga jest widoczna w samym `users.py`, więc podaje własne ścieżki routera.

Po poprawce: `read_me` jest pierwsza, a aplikacja dołącza router admina przed routerem użytkowników.

<!-- e2e -->

```python title="app/users.py"
from fastapi import APIRouter

router = APIRouter(tags=["users"])


@router.get("/me")
async def read_me() -> dict[str, str]:
    return {"name": "me"}


@router.get("/{user_id}")
async def read_user(user_id: int) -> dict[str, int]:
    return {"id": user_id}
```

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app import admin, users

app = FastAPI()
app.include_router(admin.router, prefix="/users")
app.include_router(users.router, prefix="/users")
```

<!-- e2e -->

```sh
inwards check app
```

## Jak działa { #how-it-works }

FAPI005 czyta wspólny model FastAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)).

- **Kolejność.** Na jednej aplikacji albo routerze trasy wykonują się w kolejności w kodzie, a wywołanie `include_router` wstawia trasy dołączanego routera tam, gdzie jest wywołanie. Trasy każdej aplikacji są przechodzone przez graf [FAPI003](FAPI003.md) od aplikacji w dół, więc router dołączony przez dwie aplikacje jest sprawdzany w każdej z nich.
- **Dopasowanie.** Ścieżki są porównywane segment po segmencie. Segment dosłowny pasuje do siebie, `{name}` do dowolnego jednego niepustego segmentu, `{name:int}` do cyfr, a każdy inny konwerter tylko do tego samego konwertera. Nazwy parametrów nie mają znaczenia: `/users/{id}` i `/users/{user_id}` to ta sama ścieżka. Ścieżka z parametrem `{name:path}` albo segment, który miesza tekst z parametrem (`/files/{name}.txt`), jest zgłaszana tylko jako dokładny duplikat.
- **Metody.** Obie trasy muszą mieć wspólną metodę. Trasa `GET` odpowiada też na `HEAD`. `api_route`, którego `methods=` nie jest listą literałów tekstowych, jest pomijana.
- **Co jest pomijane.** Trasa, której ścieżka albo któryś `prefix=` nad nią nie jest literałem tekstowym (`prefix=settings.API_PREFIX`), albo gdy prefiks może ustawić `**kwargs`. Inwards wtedy nic nie zgłasza, zamiast zgadywać wartość.

Gdzie działa:

- **`inwards check`**, `inwards baseline` i **Stop gate** zgłaszają oba przypadki w plikach, które sprawdzają, względem grafu całego projektu.
- **Hook PostToolUse** i edytor zgłaszają tylko to, co widać w jednym pliku: dwie trasy na tym samym routerze w tym pliku. To, czy dwa routery trafią pod ten sam prefiks, zależy też od `main.py`.

## Jak naprawić { #how-to-fix }

1. Przesłonięta na jednym routerze: przenieś trasę dosłowną (`/users/me`) nad trasę z parametrem (`/users/{user_id}`).
2. Przesłonięta między routerami: najpierw dołącz router z trasą dosłowną albo daj jednemu z routerów inny prefiks.
3. Duplikat: zostaw jedną z dwóch tras. Jeśli obie są potrzebne, daj późniejszej inną ścieżkę albo metodę.

Nie usuwaj endpointu, który się nie wykonuje, tylko po to, żeby diagnostyka zniknęła: zwykle istnieje, bo potrzebuje go klient.

## Bezpieczeństwo poprawki { #fix-safety }

Brak automatycznej poprawki (`autofix: false`). Przeniesienie dołączenia może z kolei przesłonić inne trasy, a to, który z dwóch duplikatów zostawić, jest decyzją projektową.

## Konfiguracja { #configuration }

Ważność: błąd. Opt-in: włącza się ją przez `extend-select`. Nie ma własnych opcji; `[tool.inwards.rules.route-shadowing]` przyjmuje `modules`, jak każda reguła ([tabele opcji](index.md#opt-in-rules)).

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI005"]
```

Każda diagnostyka jest na dekoratorze trasy, która się nie wykona, i można ją wyciszyć w linii przez `# inwards: ignore[FAPI005] reason="..."` w tej linii.

## Znane ograniczenia { #known-limitations }

- **Nieznana kolejność między plikami.** Trasa zadeklarowana na aplikacji albo routerze w innym module niż ten, który je tworzy (`@app.get` w module importującym `app`), powstaje przy imporcie tego modułu, czego Inwards nie widzi. Trafia za trasy pliku, który tworzy obiekt, w kolejności ścieżek plików.
- **Trasy warunkowe:** dwie trasy w dwóch gałęziach `if` liczą się obie, więc duplikat między gałęziami jest zgłaszany.
- **Dynamiczne podpinanie** (router, którego Inwards nie umie rozwiązać, prefiks niebędący literałem) zostawia pary, których dotyczy, niesprawdzone, jak opisuje FAPI003.
- **Router dołączony dwa razy** (`/v1` i `/v2`) jest sprawdzany pod każdym prefiksem, ale trasa nigdy nie jest porównywana ze swoją kopią.
- **Zamontowane aplikacje** (`app.mount("/sub", subapp)`) dopasowują własne trasy i są sprawdzane jako osobna aplikacja.

## Źródła { #references }

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): rodzina FastAPI, opt-in i wspólny model.
- [FAPI003](FAPI003.md): graf aplikacji i routerów, który przechodzi sprawdzenie między routerami.
- Dokumentacja FastAPI, [Path Parameters, Order matters](https://fastapi.tiangolo.com/tutorial/path-params/#order-matters).
