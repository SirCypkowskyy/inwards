---
source: docs/chapters/rules/FAPI007.md
source_hash: 19bf43cd2f9aed0276411882634f8a74ad438f14f7caa9cd852366027c5fe371
type: rule
title: FAPI007 yield-dependency-swallows
description: Zależność z yield rzuca ponownie to, co łapią jej klauzule except, więc błąd w endpoincie nie jest ukryty przed serwerem.
code: FAPI007
name: yield-dependency-swallows
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/yield-dependency-swallows.ts
timestamp: 2026-10-09T18:00:00Z
related_issues: [186, 226]
---

# FAPI007 `yield-dependency-swallows`

## Co robi { #what-it-does }

Opt-in. Zgłasza klauzulę `except` wokół `yield` w funkcji generatora, która ani nie rzuca wyjątku ponownie, ani nie rzuca innego:

```python
def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:   # reported: no raise on any path
        db.rollback()
    finally:
        db.close()
```

Zgłoszenie stoi na linii `except`. Klauzula przechodzi, gdy każda ścieżka przez nią rzuca wyjątek: `raise` w bloku, `if` / `else`, którego wszystkie gałęzie rzucają, `with`, którego ciało rzuca, albo `try` rzucający w `finally`. `except`, który loguje i rzuca ponownie, przechodzi, tak samo jak ten, który rzuca `HTTPException` lub jej podklasę.

## Dlaczego to źle { #why-is-this-bad }

Zależność z `yield` widzi wyjątki rzucone w endpoincie. Gdy jej blok `except` kończy się bez rzucenia, błąd zatrzymuje się tam: klient dostaje 500, a serwer nie ma logu przyczyny (dokumentacja FastAPI, "Dependencies with yield"). Wycofanie transakcji w bloku wygląda jak porządna obsługa błędu, dlatego ten wzorzec jest częsty w kodzie pisanym przez agenta. Ruff nie ma na to reguły.

## Przykład { #example }

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI007"]
```

<!-- e2e -->

```python title="app/db.py"
class Session:
    def rollback(self) -> None: ...

    def close(self) -> None: ...


def new_session() -> Session:
    return Session()
```

<!-- e2e -->

```python title="app/deps.py"
from collections.abc import Iterator

from app.db import Session, new_session


def get_db() -> Iterator[Session]:
    db = new_session()
    try:
        yield db
    except Exception:
        db.rollback()
    finally:
        db.close()
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/deps.py:10:5: FAPI007 `except Exception` around the `yield` in `get_db` never re-raises: an error from the endpoint stops here, so the client gets a 500 and the server has no log of the cause.
  fix: Re-raise the exception at the end of the except block.
    1. Finish the except block with `raise`, after the cleanup it does (a rollback, say), so FastAPI sees the error.
    2. If the client should get another status, raise an HTTPException (`raise HTTPException(...) from exc`) instead of returning quietly.
    3. Don't drop the except block to make this finding go away: the cleanup in it is needed.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI007/
```

Poprawione: wycofanie transakcji zostaje, a błąd leci dalej.

<!-- e2e -->

```python title="app/deps.py"
from collections.abc import Iterator

from app.db import Session, new_session


def get_db() -> Iterator[Session]:
    db = new_session()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
```

<!-- e2e -->

```sh
inwards check app
```

## Jak działa { #how-it-works }

FAPI007 czyta jedną funkcję naraz, bez grafu wywołań i bez modelu FastAPI. Dla każdej funkcji z własnym `yield` (nie takim z zagnieżdżonej funkcji) patrzy na instrukcje `try`, w których ciele stoi `yield`, i sprawdza każdą z ich klauzul `except` (także `except*`). Klauzula jest zgłaszana, chyba że jakaś instrukcja w niej rzuca wyjątek na każdej ścieżce, o ile widać to w składni.

Reguła czyta każdy generator z kodu projektu, nie tylko funkcje przekazane do `Depends(...)`: moduł zależności często nie importuje FastAPI, a przeszukiwanie całego projektu pod kątem użycia spowolniłoby sprawdzenie w hooku edycji. Plik jest parsowany tylko wtedy, gdy zawiera zarówno `yield`, jak i `except`.

Dwa rodzaje generatorów są pomijane, bo połykanie jest w nich poprawne: te z dekoratorem `contextmanager` lub `asynccontextmanager` (menedżer kontekstu, który tłumi błąd, robi to celowo) oraz te z dekoratorem `fixture` (fixture testowy nigdy nie widzi wyjątku testu).

## Jak naprawić { #how-to-fix }

1. Zakończ blok `except` słowem `raise`, po sprzątaniu, które wykonuje, żeby FastAPI zobaczył błąd i go zalogował.
2. Jeśli klient ma dostać inny status, rzuć w bloku `HTTPException`.
3. Nie usuwaj bloku `except`: jego sprzątanie (na przykład wycofanie transakcji) jest potrzebne.

## Bezpieczeństwo poprawki { #fix-safety }

Brak automatycznej poprawki (`autofix: false`). To, czy błąd ma dotrzeć do klienta bez zmian, czy zamienić się w `HTTPException`, to decyzja autora.

## Konfiguracja { #configuration }

Waga: błąd. Opt-in: włącz przez `extend-select`. Nie ma własnych opcji; `modules` działa jak w każdej regule ([tabele opcji](index.md#opt-in-rules)).

Każde zgłoszenie można wyciszyć w kodzie przez `# inwards: ignore[FAPI007] reason="..."` w linii `except`.

## Znane ograniczenia { #known-limitations }

- **Generatory, które nie są zależnościami**, też są zgłaszane: zwykłe `def lines(): try: yield ... except ...: log()`, do którego nic nie wrzuca wyjątku, nigdy nie widzi błędu endpointu. Wycisz je w kodzie albo oznacz dekoratorem, jeśli to menedżer kontekstu.
- **Handler, który rzuca przez wywołanie** (`fail(exc)`, gdzie `fail` zawsze rzuca), nie jest dla Inwards `raise`, więc jest zgłaszany.
- **`raise`, do którego prowadzą tylko niektóre ścieżki** (`if x: raise`), jest zgłaszany; ten na każdej gałęzi `if` / `else` przechodzi.
- **Klauzula dla wąskiego wyjątku** (`except KeyError:`) jest sprawdzana jak każda inna: błędy innych typów przechodzą dalej, ale ten jest połykany.
- **`return` w klauzuli** przed `raise` kończy ścieżkę bez rzucenia i jest zgłaszany.

## Źródła { #references }

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): rodzina FastAPI, opt-in, i wspólny model.
- Dokumentacja FastAPI, [Dependencies with yield](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/).
