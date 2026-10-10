---
source: docs/chapters/rules/FAPI009.md
source_hash: 53a831eb03dd15b7fad2ba55a65e2a463545dd4ab692cafc29241ebc26a6e40e
type: rule
title: FAPI009 depends-called
description: Depends i Security dostają funkcję zależności, a nie wynik jej wywołania przy imporcie.
code: FAPI009
name: depends-called
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/depends-called.ts
timestamp: 2026-10-09T18:00:00Z
related_issues: [186, 228]
---

# FAPI009 `depends-called`

## Co robi { #what-it-does }

Opt-in. Zgłasza `Depends(f(...))` i `Security(f(...))`, gdzie `f` jest funkcją z kodu projektu, której wywołanie nie da czegoś, co FastAPI mógłby wywoływać przy każdym żądaniu:

- funkcja **generatora** (ma `yield`): wywołanie zwraca obiekt generatora;
- funkcja **`async def`**: wywołanie zwraca korutynę, na którą nikt nie czeka;
- funkcja, której każdy `return` zwraca zwykłą wartość (tekst, liczbę, listę, słownik, `None`...) albo która nic nie zwraca.

Działa wszędzie, gdzie wywołanie jest zapisane: w wartości domyślnej argumentu, w `Annotated[T, Depends(f())]` albo w `dependencies=[Depends(f())]`. Zgłoszenie stoi na wywołaniu `Depends(...)`.

Fabryka przechodzi: `Depends(require_role("admin"))`, gdzie `require_role` zwraca funkcję wewnętrzną, to udokumentowany sposób przekazywania argumentów do zależności.

## Dlaczego to źle { #why-is-this-bad }

`Depends(get_db())` wywołuje `get_db()` raz, przy imporcie modułu, i oddaje FastAPI wynik. FastAPI oczekuje funkcji do wywoływania przy każdym żądaniu; z generatorem albo zwykłą wartością albo zawodzi przy starcie, albo, co gorsza, współdzieli jeden obiekt między wszystkie żądania. B008 Ruffa patrzy tylko na wartości domyślne argumentów, więc zalecana forma `Annotated[Session, Depends(get_db())]` (forma, którą zaleca FAST002 Ruffa) nie jest sprawdzana przez nic.

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
class Session:
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
    finally:
        db.close()
```

<!-- e2e -->

```python title="app/users.py"
from typing import Annotated

from fastapi import APIRouter, Depends

from app.db import Session
from app.deps import get_db

router = APIRouter()


@router.get("/users")
async def list_users(db: Annotated[Session, Depends(get_db())]) -> list[str]:
    return []
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/users.py:12:45: FAPI009 `Depends(get_db())` calls `get_db` once, when the module is imported, and passes its result: `get_db` is a generator function (the call returns a generator object), so FastAPI never gets a function to call per request.
  fix: Pass the function: `Depends(get_db)`.
    1. Remove the parentheses: `Depends(get_db)` hands FastAPI the function, which it calls for each request.
    2. If `get_db` needs arguments, don't call it here: make it a factory that returns the dependency function, or give the dependency parameters FastAPI resolves itself.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI009/
```

Poprawione: przekaż funkcję.

<!-- e2e -->

```python title="app/users.py"
from typing import Annotated

from fastapi import APIRouter, Depends

from app.db import Session
from app.deps import get_db

router = APIRouter()


@router.get("/users")
async def list_users(db: Annotated[Session, Depends(get_db)]) -> list[str]:
    return []
```

<!-- e2e -->

```sh
inwards check app
```

## Jak działa { #how-it-works }

FAPI009 czyta wspólny model FastAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)), który zapisuje każde wywołanie `Depends(...)` i `Security(...)` w pliku, jeśli wołana nazwa pochodzi z FastAPI (pod dowolnym aliasem importu). Gdy argument zależności sam jest wywołaniem, nazwa wołanej funkcji jest rozwiązywana przez model: w tym samym pliku albo o jeden skok przez importy projektu (`from app.deps import get_db`, `deps.get_db`). Czytana jest tylko funkcja z kodu projektu.

Funkcję ocenia się z jej własnego ciała, z pominięciem funkcji zagnieżdżonych:

- `yield` robi z niej generator;
- `async def` bez `yield` robi z niej funkcję korutynową;
- w pozostałych przypadkach patrzy się na każdy `return`, a wywołanie jest zgłaszane tylko wtedy, gdy każdy zwraca literał (tekst, liczbę, listę, krotkę, zbiór, słownik, comprehension, porównanie, `not`, `True`, `False`, `None`) albo nic nie zwraca.

## Jak naprawić { #how-to-fix }

1. Usuń nawiasy: `Depends(get_db)`. FastAPI wywołuje funkcję przy każdym żądaniu.
2. Jeśli zależność potrzebuje argumentów, zrób fabrykę zwracającą funkcję zależności (`def require_role(role): def check(...): ...; return check`) albo daj zależności własne parametry, które FastAPI rozwiąże.

## Bezpieczeństwo poprawki { #fix-safety }

Brak automatycznej poprawki (`autofix: false`). Usunięcie nawiasów zwykle jest właściwe, ale funkcja, która miała być fabryką, wymaga innego kształtu.

## Konfiguracja { #configuration }

Waga: błąd. Opt-in: włącz przez `extend-select`. Nie ma własnych opcji; `modules` działa jak w każdej regule ([tabele opcji](index.md#opt-in-rules)).

Każde zgłoszenie można wyciszyć w kodzie przez `# inwards: ignore[FAPI009] reason="..."` w pierwszej linii wywołania `Depends(...)`.

## Znane ograniczenia { #known-limitations }

Nieznane oznacza ciszę. Nic nie jest zgłaszane, gdy:

- wołana nazwa nie jest funkcją z kodu projektu (jest z biblioteki, jest klasą, lambdą albo nazwą, której Inwards nie umie rozwiązać);
- funkcja ma dekorator, bo dekorator może zmienić to, co zwraca;
- jakiś `return` to wywołanie, nazwa, atrybut albo cokolwiek, co może być wywoływalne (`return RoleChecker(role)` to instancja klasy z `__call__`, wzorzec wspierany przez FastAPI);
- zależność jest przekazana przez `*args` lub `**kwargs`.

Dalsze ograniczenia:

- **Tylko jeden skok**: nazwa reeksportowana przez kilka modułów jest śledzona, ale wywołania wewnątrz wołanej funkcji już nie.
- **Funkcja, która celowo zwraca `None`** (atrapa), jest zgłaszana jak każda inna.
- **`Depends` z innej biblioteki** o tej samej nazwie nie jest mylone z FastAPI: liczą się tylko nazwy z `fastapi`.

## Źródła { #references }

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): rodzina FastAPI, opt-in, i wspólny model.
- Dokumentacja FastAPI, [Dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/): "you only give `Depends` a single parameter... you don't call it directly".
