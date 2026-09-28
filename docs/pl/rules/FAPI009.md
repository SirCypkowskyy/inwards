---
source: docs/chapters/rules/FAPI009.md
source_hash: 72434a551191841e1accb963003f08f551a6ee6bad915a83e5890cb824bb4a20
type: rule
title: FAPI009 depends-called
description: Depends(get_db()) wywołuje zależność tam, gdzie trasa jest deklarowana, i przekazuje jej wynik zamiast samej zależności, którą FastAPI wywołałby przy każdym żądaniu.
code: FAPI009
name: depends-called
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/depends-called.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 228]
---

# FAPI009 `depends-called`

## Co robi { #what-it-does }

Zgłasza `Depends(f(...))` i `Security(f(...))`, gdy `f` to własna funkcja projektu, której wynik nie może być zależnością:

- funkcja-generator (ma `yield`): wywołanie zwraca generator;
- `async def`: wywołanie zwraca korutynę;
- funkcja, która zwraca tylko literały, `None` albo instancje własnych klas bez `__call__`.

`f` jest rozwiązywana w tym samym pliku albo przez importy, z podążaniem za reeksportami. Fabryka, która zwraca funkcję, na przykład `Depends(require_role("admin"))`, gdzie `require_role` zwraca wewnętrzne `def`, przechodzi; tak samo klasa i wszystko, czego Inwards nie umie odczytać (funkcja z zewnętrznej biblioteki, zwrócenie zmiennej lokalnej). Reguła czyta metadane `Annotated[..., Depends(...)]` i każde inne miejsce, w którym pojawia się znacznik, na przykład `dependencies=[Depends(...)]` w dekoratorze, routerze albo aplikacji. Znacznik w wartości domyślnej parametru (`db=Depends(get_db())`) zostaje dla `B008` Ruffa, chyba że włączono `check-defaults`.

## Dlaczego to źle { #why-is-this-bad }

`Depends` przyjmuje samą zależność; FastAPI wywołuje ją przy każdym żądaniu, wypełnia jej parametry i po odpowiedzi uruchamia sprzątanie generatora. `Depends(get_db())` wywołuje `get_db` raz, przy imporcie modułu, i przekazuje FastAPI obiekt generatora. FastAPI nie umie wywołać generatora, więc deklaracja trasy zawodzi, gdy tylko moduł zostanie zaimportowany; korutyna do tego nigdy nie zostaje awaitowana. Nawiasy to łatwy błąd dla agenta, a `B008` Ruffa patrzy tylko na wartości domyślne parametrów, więc formy `Annotated`, którą zaleca FastAPI (i o którą prosi `FAST002` Ruffa), nie sprawdza nic innego.

## Przykład { #example }

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI009"]
```

<!-- e2e -->

```python title="app/db.py"
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

<!-- e2e -->

```python title="app/routes.py"
from typing import Annotated

from fastapi import APIRouter, Depends

from app.db import get_db

router = APIRouter()


@router.get("/orders")
async def list_orders(db: Annotated[Session, Depends(get_db())]) -> list[int]:
    return []
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/routes.py:11:46: FAPI009 `Depends(get_db())` calls `get_db` where the route is declared and passes FastAPI the generator it returns, which FastAPI can't call as a dependency.
  fix: Pass the function itself: `Depends(get_db)`.
    1. Replace `get_db()` with `get_db`; FastAPI calls the dependency on each request and fills its parameters itself.
    2. If `get_db` needs arguments, make it a factory that returns the dependency function, or give it parameters FastAPI can fill.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI009/
```

Poprawione: `Depends` dostaje funkcję.

<!-- e2e -->

```python title="app/routes.py"
from typing import Annotated

from fastapi import APIRouter, Depends

from app.db import get_db

router = APIRouter()


@router.get("/orders")
async def list_orders(db: Annotated[Session, Depends(get_db)]) -> list[int]:
    return []
```

<!-- e2e -->

```sh
inwards check app
```

## Jak naprawić { #how-to-fix }

1. Usuń wywołanie: `Depends(get_db)`.
2. Jeśli zależność potrzebuje argumentów, napisz fabrykę, która zwraca funkcję zależności (`def require_role(role): def check(...): ...; return check`), i wywołaj fabrykę: `Depends(require_role("admin"))`.

## Bezpieczeństwo poprawki { #fix-safety }

Brak automatycznej poprawki (`autofix: false`). Usunięcie nawiasów prawie zawsze jest dobre, ale gdy wywołanie przekazuje argumenty, zależność musi zmienić kształt.

## Konfiguracja { #configuration }

Opt-in: reguła zgłasza tylko wtedy, gdy `extend-select` albo `select` wymienia `FAPI009`. Jej opcja z wartością domyślną:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI009"]

[tool.inwards.rules.depends-called]
check-defaults = false  # also report Depends(f()) in a parameter default
```

`check-defaults` jest wyłączone, bo `B008` Ruffa już zgłasza wewnętrzne wywołanie w wartości domyślnej. Włącz je w projekcie, który nie uruchamia reguł `B` Ruffa. Jak każda reguła, przyjmuje też `modules` ([tabele opcji](index.md#opt-in-rules)). Diagnostykę można wyciszyć w linii znacznika przez `# inwards: ignore[FAPI009] reason="..."`.

## Znane ograniczenia { #known-limitations }

- Funkcja, która zwraca zmienną lokalną albo wynik innego wywołania, jest traktowana tak, jakby zwracała coś wywoływalnego, i przechodzi.
- Instancja klasy z bazą, której Inwards nie widzi (bazą z zewnętrznej biblioteki), przechodzi: baza może definiować `__call__`.
- Czytany jest tylko pierwszy argument (albo `dependency=`); znacznik zbudowany przez `functools.partial` przechodzi.

## Źródła { #references }

- [ADR-037: Framework rule families, opt-in, with their own prefix](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)
- FastAPI: [Dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/), [Advanced Dependencies](https://fastapi.tiangolo.com/advanced/advanced-dependencies/)
- `B008` Ruffa zgłasza wywołanie w wartości domyślnej parametru, `FAST002` wartość domyślną `Depends`, która powinna być `Annotated`; żadna z nich nie zagląda do `Annotated[...]`.
