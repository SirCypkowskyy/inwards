---
source: docs/chapters/rules/FAPI006.md
source_hash: 07bf36c2fe50b145afa44393337b80d898f4f52323f98f954f965acceaff3a1c
type: rule
title: FAPI006 lifespan-events
description: Aplikacja FastAPI rejestruje handlery startu albo zamknięcia przez przestarzałe API zdarzeń albo obok handlera lifespan, przez który FastAPI je pomija.
code: FAPI006
name: lifespan-events
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/lifespan-events.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 225]
---

# FAPI006 `lifespan-events`

## Co robi { #what-it-does }

Zgłasza handlery startu i zamknięcia zarejestrowane przez przestarzałe API zdarzeń FastAPI:

- `@app.on_event("startup")` i `@app.on_event("shutdown")`, na aplikacji albo na `APIRouter`;
- `app.add_event_handler("startup", handler)`;
- `FastAPI(on_startup=[...])` i `FastAPI(on_shutdown=[...])`.

Każda taka rejestracja sama w sobie daje **ostrzeżenie**: FastAPI oznaczył je jako przestarzałe na rzecz jednego menedżera kontekstu `lifespan=`. W aplikacji, która ustawia też `lifespan=`, każda z nich to **błąd** na handlerze: FastAPI uruchamia wtedy tylko lifespan, więc handlery nigdy się nie wykonują. Aplikacja jest odnajdywana między plikami przez importy, więc handler w `app/events.py` na `app`, które `app/main.py` buduje z `lifespan=`, jest zgłaszany w `app/events.py`.

## Dlaczego to źle { #why-is-this-bad }

Dokumentacja FastAPI mówi to wprost: "It's all lifespan or all events, not both." Aplikacja z `lifespan=` pomija każdy handler `on_event`, bez błędu i bez wpisu w logu. Agent, który dodaje hook startu tak, jak pokazują starsze tutoriale, w projekcie, który ma już lifespan, pisze kod, który nigdy się nie wykona: pamięć podręczna nie zostanie rozgrzana, pula połączeń nie zostanie zamknięta. Narzędzia do sprawdzania typów oznaczają `on_event` jako przestarzałe, ale żadne z nich nie wie, że aplikacja w innym pliku ma lifespan.

## Przykład { #example }

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI006"]
```

Aplikacja zamyka silnik bazy danych w lifespan:

<!-- e2e -->

```python title="app/main.py"
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


app = FastAPI(lifespan=lifespan)
```

<!-- e2e -->

```python title="app/db.py"
engine = None
```

Agent dodaje handler startu w innym pliku:

<!-- e2e -->

```python title="app/events.py"
from app.db import engine
from app.main import app


@app.on_event("startup")
async def create_tables() -> None:
    await engine.create_all()
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/events.py:5:1: FAPI006 `app.on_event("startup")` never runs: `app` sets `lifespan=` (app/main.py:14), and FastAPI then ignores startup and shutdown events.
  fix: Move the handler into `app`'s lifespan function.
    1. Move the handler's code into the app's lifespan function: startup code before its `yield`, shutdown code after it.
    2. Then delete the event registration.
    3. If the project keeps the events on purpose, ask the user before suppressing this; don't edit [tool.inwards] yourself.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI006/
```

Poprawione: kod startu działa w lifespan, przed jego `yield`, a `app/events.py` znika.

<!-- e2e -->

```python title="app/main.py"
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    await engine.create_all()
    yield
    await engine.dispose()


app = FastAPI(lifespan=lifespan)
```

<!-- e2e -->

```sh
rm app/events.py
inwards check app
```

## Jak naprawić { #how-to-fix }

1. Przenieś treść handlera do funkcji lifespan: kod startu przed jej `yield`, kod zamknięcia po nim.
2. Usuń rejestrację `on_event`, `add_event_handler`, `on_startup=` albo `on_shutdown=`.
3. Jeśli lifespan jeszcze nie ma, napisz go (`@asynccontextmanager async def lifespan(app)`) i przenieś do niego od razu wszystkie handlery zdarzeń aplikacji: FastAPI uruchamia albo lifespan, albo zdarzenia.

## Bezpieczeństwo poprawki { #fix-safety }

Brak automatycznej poprawki (`autofix: false`). Przeniesienie kodu do lifespan zmienia moment, w którym działa względem reszty startu, i powinien to sprawdzić człowiek.

## Konfiguracja { #configuration }

Opt-in: reguła zgłasza tylko wtedy, gdy `extend-select` albo `select` wymienia `FAPI006`. Poza `modules` nie ma opcji ([tabele opcji](index.md#opt-in-rules)). Ostrzeżenia i błędy mają ten sam kod, więc `severity = { FAPI006 = "warning" }` zamienia oba w ostrzeżenia. Diagnostykę można wyciszyć w linii rejestracji przez `# inwards: ignore[FAPI006] reason="..."`.

## Znane ograniczenia { #known-limitations }

- Rejestracja na odbiorcy, którego Inwards nie umie rozwiązać do aplikacji albo routera FastAPI, na przykład na parametrze `app` funkcji `register(app)`, nie jest zgłaszana.
- Handlery routera dostają tylko ostrzeżenie. Czy aplikacja, która dołącza router, ustawia `lifespan=`, wymagałoby grafu dołączeń.
- Aplikacja, której konstruktor dostaje `**kwargs`, może mieć stamtąd lifespan; jej handlery dają wtedy ostrzeżenia, a nie błędy.
- Lifespan ustawiony po utworzeniu aplikacji (`app.router.lifespan_context = ...`) nie jest widoczny.

## Źródła { #references }

- [ADR-037: Framework rule families, opt-in, with their own prefix](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)
- FastAPI: [Lifespan Events](https://fastapi.tiangolo.com/advanced/events/)
- Ruff nie ma na to reguły; jego reguły `FAST` nie patrzą na zdarzenia.
