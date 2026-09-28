---
source: docs/chapters/rules/FAPI007.md
source_hash: 49c387e753c51a3d903a348bfbbafcead4a8bcf2f815ba70aea78a88cac086d8
type: rule
title: FAPI007 yield-dependency-swallows
description: Zależność FastAPI z yield ma wokół yield blok except, który może się skończyć bez raise, więc połyka to, co rzucił endpoint.
code: FAPI007
name: yield-dependency-swallows
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/yield-dependency-swallows.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 226]
---

# FAPI007 `yield-dependency-swallows`

## Co robi { #what-it-does }

Zgłasza klauzulę `except` wokół `yield` zależności z `yield`, gdy jakaś ścieżka przez tę klauzulę kończy się bez `raise`. Jedna diagnostyka na klauzulę, w jej linii `except ...:`.

Zależność jest rozpoznawana po kształcie, na poziomie funkcji, bez szukania `Depends(...)`, które jej używa: funkcja-generator bez dekoratora (`def` albo `async def`) z dokładnie jednym `yield`, poza pętlą. Plik nie musi wspominać FastAPI, więc `get_db` w `app/db.py` też jest sprawdzane. Klauzula przechodzi, gdy każda ścieżka przez nią rzuca wyjątek: gołe `raise`, `raise HTTPException(...)` albo dowolny inny wyjątek. Reguła śledzi `if`/`elif`/`else`, `try` i `with`, a pętlę albo `match` z `raise` w środku traktuje jak rzucające. Klauzula, która obsługuje tylko `GeneratorExit`, jest pomijana.

## Dlaczego to źle { #why-is-this-bad }

FastAPI wykonuje kod po `yield` zależności, gdy odpowiedź jest gotowa, i wrzuca wyjątek endpointu w miejscu `yield`. `except` w tym miejscu, który ani nie rzuca ponownie, ani nie rzuca czegoś innego, połyka go. Dokumentacja FastAPI opisuje, co dzieje się dalej: klient dostaje 500 Internal Server Error, nawet gdy endpoint rzucił `HTTPException` z 404, a serwer nie ma w logu śladu błędu. Agent, który pisze znany wzorzec `try: yield db` / `except: db.rollback()`, wypuszcza API, którego błędy znikają.

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
def get_db():
    db = SessionLocal()
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
app/db.py:5:5: FAPI007 `except Exception:` in `get_db` can end without raising, so it swallows what the endpoint raised at the `yield`: the client gets a 500, even for an HTTPException, and the server logs nothing.
  fix: End `except Exception:` in `get_db` with a `raise`.
    1. Keep the cleanup (a rollback, say), then re-raise with a bare `raise`, or raise an `HTTPException` that says what went wrong.
    2. Put cleanup that must always run in `finally:` rather than in `except`.
    3. If the dependency swallows the error on purpose, ask the user before suppressing this; don't edit [tool.inwards] yourself.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI007/
```

Poprawione: rollback zostaje, a wyjątek trafia dalej do FastAPI.

<!-- e2e -->

```python title="app/db.py"
def get_db():
    db = SessionLocal()
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

## Jak naprawić { #how-to-fix }

1. Zakończ klauzulę gołym `raise`, po sprzątaniu.
2. Albo rzuć `HTTPException` (albo podklasę), który mówi klientowi, co poszło nie tak.
3. Sprzątanie, które musi się wykonać zawsze, umieść w `finally:`, które w ogóle nie potrzebuje `except`.

## Bezpieczeństwo poprawki { #fix-safety }

Brak automatycznej poprawki (`autofix: false`). Czy rzucić wyjątek ponownie, czy odpowiedzieć konkretnym statusem, to decyzja o API.

## Konfiguracja { #configuration }

Opt-in: reguła zgłasza tylko wtedy, gdy `extend-select` albo `select` wymienia `FAPI007`. Poza `modules` nie ma opcji ([tabele opcji](index.md#opt-in-rules)). Diagnostykę można wyciszyć w linii `except` przez `# inwards: ignore[FAPI007] reason="..."`.

## Znane ograniczenia { #known-limitations }

- Zależność jest rozpoznawana po kształcie, więc zwykły generator o tym samym kształcie (jeden `yield`, poza pętlą, bez dekoratora), który nigdy nie jest zależnością, też jest sprawdzany. Generatory, które zwracają wartości w pętli, na przykład odpowiedzi strumieniowe, oraz funkcje z `@contextmanager` albo `@pytest.fixture` są pomijane.
- Zależność z dwoma `yield` albo z innym dekoratorem nie jest sprawdzana.
- Wywołanie, które zawsze rzuca wyjątek, na przykład `sys.exit()` albo funkcja pomocnicza, która rzuca, nie liczy się jako `raise`.
- Pętla albo `match` z jakimkolwiek `raise` w środku liczy się jako rzucająca, nawet gdy jakaś ścieżka przez nią nie rzuca.

## Źródła { #references }

- [ADR-037: Framework rule families, opt-in, with their own prefix](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)
- FastAPI: [Dependencies with yield and except](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/#dependencies-with-yield-and-except)
- `S110` Ruffa zgłasza `except Exception: pass` w dowolnym miejscu; nie wie, że klauzula zależności widzi wyjątki endpointu, a klauzula, która coś robi, zanim połknie wyjątek, przechodzi.
