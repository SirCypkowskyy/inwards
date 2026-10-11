---
source: docs/chapters/rules/FAPI002.md
source_hash: e1d786ef86170945bf0b328659cb74613d169a87c1804954930ad5ac3cb5f6e3
type: rule
title: FAPI002 undocumented-error-response
description: Operacja ścieżki FastAPI może zwrócić kod błędu, bezpośrednio, przez funkcję pomocniczą albo zależność, albo przez handler wyjątków aplikacji, którego jej wpis OpenAPI nie deklaruje.
code: FAPI002
name: undocumented-error-response
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/undocumented-error-response.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 183, 242]
---

# FAPI002 `undocumented-error-response`

## Co robi { #what-it-does }

Zgłasza operację ścieżki FastAPI, która może zwrócić kod błędu (domyślnie 4xx) niezadeklarowany w jej wpisie OpenAPI. Jedna diagnostyka na endpoint, na jego dekoratorze, wymienia kody i skąd każdy pochodzi, żeby dało się to sprawdzić. Kod liczy się jako zwracany w kolejnych pierścieniach:

| Pierścień | Źródło |
|---|---|
| 0 | `raise HTTPException(404)` albo `HTTPException(status_code=404)` w endpoincie oraz `return JSONResponse(..., status_code=404)` (dowolna klasa odpowiedzi FastAPI albo Starlette) |
| 1 | To samo w funkcji z tego samego pliku, którą endpoint wywołuje po nazwie, albo w zależności podanej jako `Depends(fn)` lub `Annotated[T, Depends(fn)]` |
| 2 | To samo we własnej funkcji albo zależności zaimportowanej z innego modułu, czytanej leniwie. `dependencies=[Depends(...)]` na dekoratorze, na `APIRouter(...)`, na `include_router(...)` albo na `FastAPI(...)` liczy się dla każdej trasy pod nim |
| 3 | Rzucony własny wyjątek, na który handler wyjątków aplikacji odpowiada literalnym kodem statusu, szukany przez klasy bazowe wyjątku tak jak w Starlette; oraz podklasa `HTTPException`, której `__init__` ustala kod |

Pierścienie 1 i 2 idą najwyżej `max-depth` wywołań w głąb (domyślnie 2). Kod to literał całkowity, stała `status.HTTP_*` z FastAPI albo Starlette, element `HTTPStatus` albo własna stała modułu, która trzyma jedno z nich.

Kod liczy się jako zadeklarowany, gdy ma go `responses=` (klucz liczbowy albo tekstowy, albo `"4XX"`, `"5XX"` lub `"default"`) na dekoratorze, na `APIRouter(...)` trasy, na `include_router(...)`, które do niej prowadzi, albo na `FastAPI(...)`; liczą się też `**NAZWA` słownika z poziomu modułu i `openapi_extra={"responses": {...}}`. FastAPI sam dokumentuje 422 dla operacji z parametrami, więc FAPI002 też tak robi, chyba że `explicit-422 = "report"`.

## Dlaczego to źle { #why-is-this-bad }

FastAPI buduje schemat z tego, co kod deklaruje, i nie widzi `raise` ([fastapi#9124](https://github.com/fastapi/fastapi/issues/9124): zadeklaruj to w `responses=`). Agent dodaje 404 w funkcji pomocniczej albo błąd domenowy, który handler aplikacji zamienia na 409, i nie rusza dekoratora. Wygenerowany klient nie ma wtedy gałęzi dla tego błędu, a frontend dowiaduje się o nim na produkcji.

## Przykład { #example }

Z trzema warstwami z [INW001](INW001.md#example) włącz FAPI002:

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]

[tool.inwards.rules]
extend-select = ["FAPI002"]
```

Serwis rzuca błąd domenowy, a aplikacja zamienia go na 409:

<!-- e2e -->

```python title="shop/infrastructure/db.py"
import shop.domain.order


class OrderOut: ...


class OutOfStock(Exception): ...


def reserve(order: OrderOut) -> None:
    raise OutOfStock()
```

<!-- e2e -->

```python title="shop/infrastructure/app.py"
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from shop.infrastructure import orders
from shop.infrastructure.db import OutOfStock

app = FastAPI()
app.include_router(orders.router)


@app.exception_handler(OutOfStock)
async def out_of_stock(request: Request, exc: OutOfStock) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": "Out of stock"})
```

Endpoint wczytuje zamówienie przez funkcję pomocniczą, która rzuca 404, a potem je rezerwuje:

<!-- e2e -->

```python title="shop/infrastructure/orders.py"
from fastapi import APIRouter, HTTPException

from shop.infrastructure.db import OrderOut, reserve

router = APIRouter(prefix="/orders", tags=["orders"])


def load_or_404(order_id: int) -> OrderOut:
    raise HTTPException(status_code=404, detail="No such order")


@router.post("/{order_id}/confirm", status_code=200, summary="Confirm an order")
async def confirm_order(order_id: int) -> OrderOut:
    order = load_or_404(order_id)
    reserve(order)
    return order
```

<!-- e2e -->

```sh
inwards check
```

<!-- e2e -->

```text
shop/infrastructure/orders.py:12:1: FAPI002 `confirm_order` can return 404 and 409, which its OpenAPI entry doesn't declare.
  fix: Declare 404 and 409 in `responses=` on `@router.post("/{order_id}/confirm")`.
    1. `confirm_order` can return 404 (from `load_or_404` at shop/infrastructure/orders.py:9) and 409 (from `OutOfStock` raised at shop/infrastructure/db.py:11, handled in shop/infrastructure/app.py:11), but its OpenAPI entry declares none of them.
    2. Add `responses={404: {"description": "..."}, 409: {"description": "..."}}` to the decorator (with a "model" where the error has a body), or to `APIRouter(...)` if every route shares them.
    3. Don't remove the `raise`, and don't catch the error only to silence this finding: clients generated from the schema need to know the error exists.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI002/
```

Poprawiony: dekorator deklaruje oba błędy.

<!-- e2e -->

```python title="shop/infrastructure/orders.py"
from fastapi import APIRouter, HTTPException

from shop.infrastructure.db import OrderOut, reserve

router = APIRouter(prefix="/orders", tags=["orders"])


def load_or_404(order_id: int) -> OrderOut:
    raise HTTPException(status_code=404, detail="No such order")


@router.post(
    "/{order_id}/confirm",
    status_code=200,
    summary="Confirm an order",
    responses={
        404: {"description": "No such order"},
        409: {"description": "A product is out of stock"},
    },
)
async def confirm_order(order_id: int) -> OrderOut:
    order = load_or_404(order_id)
    reserve(order)
    return order
```

<!-- e2e -->

```sh
inwards check
```

## Jak naprawić { #how-to-fix }

1. Sprawdź każdy kod u źródła: diagnostyka podaje plik i linię każdego `raise` albo handlera.
2. Zadeklaruj kody w `responses=`, z `description` i, gdy błąd ma treść, z `model`. Umieść je na `APIRouter(...)` albo `include_router(...)`, gdy dzielą je wszystkie trasy pod nim.
3. Nie usuwaj `raise` i nie łap błędu tylko po to, żeby diagnostyka zniknęła.

## Bezpieczeństwo poprawki { #fix-safety }

Bez automatycznej poprawki (`autofix: false`). Opis i model błędu są częścią API.

## Konfiguracja { #configuration }

Opt-in: reguła zgłasza tylko wtedy, gdy `extend-select` albo `select` wymienia `FAPI002`. Jej opcje z wartościami domyślnymi:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI002"]

[tool.inwards.rules.undocumented-error-response]
codes = "4xx"                         # or "4xx-5xx"
max-depth = 2                         # calls followed into helpers and dependencies, 0 to 8
report-direct-raises = true           # false leaves raises in the endpoint itself to Ruff FAST004
handled-counts-as-documented = false  # true: codes from app exception handlers count as declared
explicit-422 = "ignore"               # "report": a raised 422 must be declared too
```

Nieznany klucz albo zła wartość to błąd konfiguracji, który podaje klucz. Jak każda reguła, przyjmuje też `modules` ([tabele opcji](index.md#opt-in-rules)). Diagnostykę można wyciszyć w linii dekoratora przez `# inwards: ignore[FAPI002] reason="..."`.

`FAST004` Ruffa (w recenzji) obejmuje pierścień 0 z `responses=` w tym samym pliku. Gdy trafi do wydania, `report-direct-raises = false` sprawi, że obie reguły nie zgłoszą tego samego `raise`.

## Znane ograniczenia { #known-limitations }

Nieznane znaczy ciche: FAPI002 woli przeoczyć diagnostykę niż zgłosić błędną.

- Kod statusu, którego nie umie odczytać (`HTTPException(code)`), `responses=`, które nie jest literałem (`responses=build()`), dekorator z `**kwargs` albo dołączenie, którego nie umie rozwiązać (`include_router(getattr(m, "router"))`, router zwracany przez fabrykę, `include_router(r, **opts)`), sprawia, że ten kod albo endpoint jest nieznany i nic dla niego nie jest zgłaszane. Jedno nierozwiązane dołączenie gdziekolwiek sprawia, że nieznana jest każda trasa na routerze. Dołączenia są czytane z grafu aplikacji i routerów, którego używa FAPI003 ([`graph.ts`](FAPI003.md)), więc pętla po literalnej liście routerów się liczy.
- Metody wstrzykniętych obiektów (`svc.place()`) nie są śledzone, podobnie jak kod zewnętrzny, wywołania przez `getattr` i wszystko, co aplikacja robi w czasie działania (trasy dodawane w pętlach, nadpisane `app.openapi()`, middleware).
- Nie ma analizy przepływu: `raise` liczy się, jeśli jest w funkcji, nawet w gałęzi, do której ten endpoint nigdy nie trafia. `except X` wokół wywołania odejmuje tylko własne wyjątki, które są `X` albo po nim dziedziczą.
- Handlery wyjątków liczą się tylko w aplikacjach, które obsługują trasę: w tej, na której trasa jest zadeklarowana, albo w każdej aplikacji, która dołącza jej router, bezpośrednio albo przez inne routery. Handler w innej aplikacji (na przykład w aplikacji health-check workera) się nie liczy, podobnie jak handler w aplikacji, która montuje aplikację trasy, bo zamontowana aplikacja sama obsługuje swoje wyjątki.
- Handlery są czytane z `@app.exception_handler(X)`, `app.add_exception_handler(X, h)` (także w pętli `for` po literalnej liście albo krotce wyjątków) i z `exception_handlers=` w `FastAPI(...)`. Ta tabela może być słownikiem, nazwą związaną ze słownikiem w tym samym pliku albo wpisem `"exception_handlers"` w słowniku rozpakowanym w `FastAPI(**kwargs)`, także w słowniku, który wywołanie w tym samym pliku przekazuje do fabryki aplikacji. `**kwargs`, którego słownik ustawia inne klucze, nadal ukrywa pozostałe argumenty aplikacji i jej trasy pozostają nieznane.
- Rzucony własny wyjątek nic nie wnosi w aplikacji z rejestracją, której Inwards nie umie odczytać: pętlą po słowniku wyjątków albo rozpakowanym słownikiem, który pochodzi z innego pliku, jest zmieniany w miejscu (`kwargs.update(...)`) albo należy do fabryki, której żadne wywołanie w pliku nie osiąga. Tak samo jest z klasą dziedziczącą po wyjątku zewnętrznym, którego handlera Inwards może nie widzieć. Handler dla klasy wbudowanej albo zewnętrznej, na przykład catch-all dla `Exception`, jest czytany, ale nie mapuje żadnego kodu: taki handler często wybiera kod w środku, według typu wyjątku.
- Funkcja-generator wywołana po nazwie (treść `StreamingResponse`) nie jest czytana, bo wywołanie jej nie uruchamia.
- Gdy do jednego routera prowadzi kilka dołączeń, liczy się kod zadeklarowany w którymkolwiek z nich.
- Żeby ustalić, co jest nad routerem, FAPI002 czyta raz na sprawdzenie każdy plik projektu z FastAPI. W hooku po edycji robi to tylko dla trasy z kodem, którego nie deklarują jej dekorator ani router.
- **Zmierzona na korpusie** ([#182](https://github.com/SirCypkowskyy/inwards/issues/182), [rozdział 6](../06-Constraints-and-Quality.md#precision-of-the-opt-in-rules)): 18 zgłoszeń przed regułą o `openapi_url`, 17 po niej; 8 obejrzanych, wszystkie trafne (każdy podany kod rzuca endpoint albo zależność). Usunięte było na back office Polara, aplikacji z `openapi_url=None`. Własna klasa routera Polara ukrywa większość jego endpointów ([#358](https://github.com/SirCypkowskyy/inwards/issues/358)).

## Źródła { #references }

- [ADR-037: Framework rule families, opt-in, with their own prefix](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)
- FastAPI: [Additional Responses in OpenAPI](https://fastapi.tiangolo.com/advanced/additional-responses/), [Handling Errors](https://fastapi.tiangolo.com/tutorial/handling-errors/)
- [fastapi/fastapi#9124](https://github.com/fastapi/fastapi/issues/9124), [astral-sh/ruff#25120](https://github.com/astral-sh/ruff/pull/25120) (`FAST004`)
