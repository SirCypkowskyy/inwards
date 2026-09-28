---
source: docs/chapters/rules/FAPI001.md
source_hash: 6dee19f72e3b66f9a60eb2f1ec9b2eced41c8df27b4cbad02de61074f1951892
type: rule
title: FAPI001 endpoint-metadata
description: Operacja ścieżki FastAPI w schemacie OpenAPI nie ma metadanych, których wymaga projekt, na przykład podsumowania, modelu odpowiedzi albo jawnego kodu statusu.
code: FAPI001
name: endpoint-metadata
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/endpoint-metadata.ts
timestamp: 2026-09-28T00:00:00Z
related_issues: [186, 183]
---

# FAPI001 `endpoint-metadata`

## Co robi { #what-it-does }

Zgłasza operację ścieżki FastAPI (`@router.get(...)`, `@app.post(...)`, `@router.api_route(...)`), której wpis OpenAPI nie ma metadanych wymaganych przez projekt. Jedna diagnostyka na endpoint, na jego dekoratorze, wymienia wszystko, czego brakuje. Domyślnie reguła wymaga:

- podsumowania: `summary=` albo docstringu (FastAPI robi z niego opis, a podsumowanie wraca wtedy do nazwy funkcji);
- modelu odpowiedzi: `response_model=` albo adnotacji typu zwracanego, z której FastAPI zbuduje schemat, czym nie są `Response` i jego podklasy. Trasa ze `status_code=204` jest zwolniona;
- jawnego `status_code=` dla `POST` i `DELETE`, bo 200 rzadko pasuje do tworzenia albo usuwania;
- pola `description` w każdym wpisie `responses=`.

Można też wymagać tagów i `operation_id` (zobacz [Konfigurację](#configuration)). Trasy z `include_in_schema=False`, w dekoratorze albo w ich `APIRouter(...)`, nie mają wpisu OpenAPI i są pomijane.

## Dlaczego to źle { #why-is-this-bad }

Schemat OpenAPI to kontrakt, z którego powstają frontend i każdy wygenerowany klient, a FastAPI wypełnia go tylko tym, co kod deklaruje. Endpoint bez podsumowania pokazuje nazwę funkcji, bez modelu odpowiedzi pusty schemat, a tworzenie zasobu, które odpowiada 200, nic klientowi nie mówi. Agenci dodają endpointy szybko i rzadko wracają po metadane.

## Przykład { #example }

Z trzema warstwami z [INW001](INW001.md#example) włącz FAPI001:

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]

[tool.inwards.rules]
extend-select = ["FAPI001"]
```

Agent dodaje endpoint, który tworzy zamówienie:

<!-- e2e -->

```python title="shop/infrastructure/orders.py"
from fastapi import APIRouter

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("/")
async def create_order(body: OrderIn):
    ...
```

<!-- e2e -->

```sh
inwards check
```

<!-- e2e -->

```text
shop/infrastructure/orders.py:6:1: FAPI001 `create_order` (POST /) has no summary, explicit status code or response model in its OpenAPI metadata.
  fix: Declare the missing OpenAPI metadata on `@router.post("/")`.
    1. Add `summary="..."` (or a docstring) and `status_code=201` to `@router.post("/")`, and a return annotation or `response_model=...`.
    2. Write a summary that says what the endpoint does, not the function name; declare the model the endpoint really returns.
    3. If the project doesn't want this metadata, ask the user to change [tool.inwards.rules.endpoint-metadata]; don't edit [tool.inwards] yourself.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI001/
```

Poprawiony: endpoint mówi, co robi, co zwraca i jakim statusem odpowiada.

<!-- e2e -->

```python title="shop/infrastructure/orders.py"
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/orders", tags=["orders"])


class OrderIn(BaseModel):
    product_id: int


class OrderOut(BaseModel):
    id: int


@router.post("/", status_code=201, summary="Place an order")
async def create_order(body: OrderIn) -> OrderOut:
    return OrderOut(id=1)
```

<!-- e2e -->

```sh
inwards check
```

## Jak naprawić { #how-to-fix }

1. Dodaj do dekoratora to, co wymienia diagnostyka: `summary="..."` albo docstring, `status_code=`, `"description"` w każdym wpisie `responses=`.
2. Zadeklaruj model, który endpoint zwraca, jako adnotację typu zwracanego albo `response_model=`. Bezpośrednio zwracany `Response` nie daje FastAPI niczego do udokumentowania.
3. Jeśli projekt nie chce któregoś sprawdzenia, wyłącz je w `[tool.inwards.rules.endpoint-metadata]` zamiast dopisywać zastępcze metadane.

## Bezpieczeństwo poprawki { #fix-safety }

Bez automatycznej poprawki (`autofix: false`). Podsumowanie i kod statusu to decyzje o API, a nie tekst do wygenerowania.

## Konfiguracja { #configuration }

Opt-in: reguła zgłasza tylko wtedy, gdy `extend-select` albo `select` wymienia `FAPI001`. Jej opcje z wartościami domyślnymi:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI001"]

[tool.inwards.rules.endpoint-metadata]
require-summary = "summary-or-docstring"  # or "summary" (summary= itself), or false
require-response-model = true             # response_model= or a usable return annotation
require-status-code = ["post", "delete"]  # methods that need an explicit status_code=
require-response-fields = ["description"] # keys every responses= entry needs: description, model, content
require-tags = false                      # tags= on the route, its router, or an include_router above it
require-operation-id = false              # an explicit operation_id=, for generated clients
```

`false`, a dla listy `[]`, wyłącza sprawdzenie. Nieznany klucz albo zła wartość to błąd konfiguracji, który podaje klucz. Jak każda reguła, przyjmuje też `modules` ([tabele opcji](index.md#opt-in-rules)). Diagnostykę można wyciszyć w linii dekoratora przez `# inwards: ignore[FAPI001] reason="..."`.

## Znane ograniczenia { #known-limitations }

- Dekorator z `**kwargs` jest pomijany: metadane mogą być w środku.
- `require-tags` liczy tagi podane w `include_router(...)` w innym pliku; dołączenie, którego Inwards nie umie rozwiązać (na przykład router w pętli), ucisza sprawdzenie.
- Reguła sprawdza, czy podsumowanie istnieje, a nie czy jest dobre.
- `include_in_schema=False` na `include_router(...)` gdzie indziej jest brane pod uwagę tylko przez dołączenia, które Inwards umie rozwiązać.
- Trasy dodawane w czasie działania (`add_api_route`, pętle po konfiguracji) nie są widoczne.

## Źródła { #references }

- [ADR-037: Framework rule families, opt-in, with their own prefix](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)
- FastAPI: [Path Operation Configuration](https://fastapi.tiangolo.com/tutorial/path-operation-configuration/), [Response Model](https://fastapi.tiangolo.com/tutorial/response-model/)
- `FAST001` Ruffa zgłasza *zbędny* `response_model`; FAPI001 zgłasza brakujący.
