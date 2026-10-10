---
source: docs/chapters/rules/FAPI006.md
source_hash: f0cb6b7f731bc7e6f0eb8df6b614eff9454eb5cf9c60da141e5d134ecde289d4
type: rule
title: FAPI006 lifespan-events
description: Aplikacje FastAPI używają menedżera kontekstu lifespan, a nie przestarzałych handlerów on_event, i nigdy obu naraz, więc każdy handler startu i zamknięcia się wykonuje.
code: FAPI006
name: lifespan-events
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/lifespan-events.ts
timestamp: 2026-10-09T18:00:00Z
related_issues: [186, 225]
---

# FAPI006 `lifespan-events`

## Co robi { #what-it-does }

Opt-in. Zgłasza przestarzałe zdarzenia startu i zamknięcia aplikacji lub routera FastAPI:

- **Przestarzałe (ostrzeżenie):** `@app.on_event("startup")`, `@app.on_event("shutdown")`, `app.add_event_handler(...)` i `FastAPI(on_startup=..., on_shutdown=...)` (to samo na `APIRouter`). FastAPI zastępuje je menedżerem kontekstu `lifespan=`.
- **Nigdy się nie wykona (błąd):** ta sama rejestracja na aplikacji, która ustawia też `lifespan=`, albo na routerze, który dołącza aplikacja z `lifespan=`. FastAPI uruchamia wtedy tylko lifespan, a handlery są po cichu ignorowane.

Zgłoszenie stoi na rejestracji: dekoratorze `@app.on_event(...)`, wywołaniu `add_event_handler` albo argumencie `on_startup=` / `on_shutdown=`. Odbiorca może być w innym pliku: handler w `app/events.py` jest dopasowywany do aplikacji w `app/main.py` przez importy projektu.

## Dlaczego to źle { #why-is-this-bad }

Dokumentacja FastAPI mówi to wprost: "It's all lifespan or all events, not both." Agent, który dopisze `@app.on_event("startup")` do aplikacji z już ustawionym `lifespan=`, pisze handler, który nigdy się nie wykona. Nic nie zawodzi przy starcie, pula połączeń nigdy się nie otwiera, a dowiaduje się o tym dopiero pierwsze żądanie. Ruff nie ma na to reguły.

## Przykład { #example }

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI006"]
```

<!-- e2e -->

```python title="app/main.py"
from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(lifespan=lifespan)
```

<!-- e2e -->

```python title="app/events.py"
from app.main import app


@app.on_event("startup")
async def connect() -> None:
    print("connecting")
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/events.py:4:1: FAPI006 `@app.on_event("startup")` never runs: `app` (app/main.py:11) sets `lifespan=`, and FastAPI then ignores event handlers. It's all lifespan or all events, not both.
  fix: Move the handler into the lifespan context manager.
    1. Move what this handler does into the lifespan function that is already set.
    2. Write one async lifespan function that takes the app, with the startup code before its `yield` and the shutdown code after it, wrap it with `contextlib.asynccontextmanager`, and pass it as `lifespan=`.
    3. Delete the old handler only after its body has moved: don't remove it to make this finding go away, as its startup or shutdown work would be lost.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI006/
```

Poprawione: kod startu przechodzi do lifespan, przed `yield`.

<!-- e2e -->

```python title="app/main.py"
from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("connecting")
    yield


app = FastAPI(lifespan=lifespan)
```

<!-- e2e -->

```sh
rm app/events.py
inwards check app
```

## Jak działa { #how-it-works }

FAPI006 czyta wspólny model FastAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)): każdy dekorator `on_event` i wywołanie `add_event_handler` jest zapisywane razem z aplikacją lub routerem, na którym je wywołano, a odbiorca jest rozwiązywany do swojego wywołania `FastAPI(...)` lub `APIRouter(...)`, w tym pliku albo w innym.

- Rejestracja na obiekcie, którego konstruktor przekazuje `lifespan=` (cokolwiek poza `None`), to błąd.
- Rejestracja na routerze to też błąd, gdy aplikacja albo router pod nią, który go dołącza, przekazuje `lifespan=`. Dołączenia pochodzą z grafu aplikacji i routerów z [FAPI003](FAPI003.md).
- Każda inna rejestracja oraz każde `on_startup=` / `on_shutdown=`, które nie jest pustą listą ani `None`, to ostrzeżenie.

Gdzie działa:

- **`inwards check`**, `inwards baseline` i **Stop gate** zgłaszają wszystkie trzy.
- **Hook PostToolUse** i edytor nie czytają grafu routerów: handler routera jest tam ostrzeżeniem, a Stop gate podnosi go do błędu, gdy aplikacja nad nim ma lifespan.

## Jak naprawić { #how-to-fix }

1. Napisz jedną funkcję `@asynccontextmanager`, która przyjmuje aplikację: kod startu idzie przed jej `yield`, kod zamknięcia po nim.
2. Przekaż ją jako `FastAPI(lifespan=...)` i usuń handlery `on_event` oraz listy `on_startup=` / `on_shutdown=`, gdy ich treść już przeniesiono.
3. Nie usuwaj handlera, żeby uciszyć zgłoszenie: praca, którą wykonuje przy starcie lub zamknięciu, przepadłaby.

## Bezpieczeństwo poprawki { #fix-safety }

Brak automatycznej poprawki (`autofix: false`). Scalenie handlerów w lifespan zmienia kolejność, w jakiej wykonuje się kod startu i zamknięcia, a to decyzja autora.

## Konfiguracja { #configuration }

Waga: błąd, a zgłoszenia samej przestarzałości mają wagę ostrzeżenia. Opt-in: włącz przez `extend-select`. Nie ma własnych opcji; `modules` działa jak w każdej regule ([tabele opcji](index.md#opt-in-rules)).

Każde zgłoszenie można wyciszyć w kodzie przez `# inwards: ignore[FAPI006] reason="..."` w linii rejestracji.

## Znane ograniczenia { #known-limitations }

Nieznane oznacza ciszę dla błędu: rejestracja zostaje ostrzeżeniem, gdy

- konstruktor aplikacji przekazuje `**kwargs`, które mogą ukrywać `lifespan=`;
- któregoś `include_router` w projekcie nie da się śledzić, więc rodzice routera są nieznani.

Dalsze ograniczenia:

- **Odbiorca, którego Inwards nie umie rozwiązać** do wywołania `FastAPI(...)` lub `APIRouter(...)`, na przykład aplikacja, którą funkcja dostaje jako parametr, w ogóle nie jest zgłaszany.
- **Aplikacje Starlette** (`Starlette(on_startup=...)`) nie są czytane, tylko `FastAPI` i `APIRouter`.
- **Lifespan ustawiony po konstrukcji** (`app.router.lifespan_context = ...`) nie jest widoczny.
- **Plik, który nie wspomina FastAPI**, jest czytany tylko wtedy, gdy zawiera `on_event` lub `add_event_handler`.

## Źródła { #references }

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): rodzina FastAPI, opt-in, i wspólny model.
- Dokumentacja FastAPI, [Lifespan Events](https://fastapi.tiangolo.com/advanced/events/): "It's all lifespan or all events, not both."
