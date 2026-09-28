---
source: docs/chapters/rules/FAPI003.md
source_hash: 88fc0345b7ced156b99403dc63085fa5aa0bec0749d550ba41d43563421cf295
type: rule
title: FAPI003 router-wiring
description: Każdy APIRouter z trasami jest dołączony do aplikacji, a routery nie dołączają się nawzajem w cyklu.
code: FAPI003
name: router-wiring
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/router-wiring.ts
timestamp: 2026-09-28T18:00:00Z
related_issues: [186, 184]
---

# FAPI003 `router-wiring`

## Co robi { #what-it-does }

Opt-in. Zgłasza trzy sposoby, w jakie trasy routera FastAPI znikają bez żadnego błędu:

- **Niepodpięty router:** `APIRouter(...)` przypisany do nazwy na poziomie modułu, z co najmniej jedną operacją ścieżki, do którego żadna aplikacja nie dochodzi przez `include_router` ani `mount`, bezpośrednio ani przez inne routery. Zgłaszany w linii `APIRouter(...)`.
- **Cykl dołączeń:** routery, które dołączają się nawzajem, bezpośrednio albo przez inne, albo router, który dołącza sam siebie. Każda grupa routerów jest zgłaszana raz, z całym cyklem w komunikacie, na wywołaniu `include_router`, które go zamyka.
- **Dołączony przed swoimi trasami:** w jednym pliku `parent.include_router(child)` na poziomie modułu wykonuje się nad dekoratorem `@child.get(...)`. `include_router` kopiuje trasy istniejące w chwili wywołania, więc trasy poniżej niego przepadają.

## Dlaczego to źle { #why-is-this-bad }

Agent dodaje `app/invoices/router.py` z trzema endpointami i testuje je na samym routerze, ale nigdy nie dopisuje `app.include_router(...)` do `main.py`. Testy przechodzą, a endpointów nie ma. FastAPI nie narzeka na router, którego nikt nie dołącza, a Ruff sprawdza jeden plik naraz, więc nic innego tego nie zgłasza. Cykl albo dołączenie nad trasami daje aplikacji zbiór tras zależny od kolejności wywołań.

## Przykład { #example }

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI003"]
```

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app.orders import router as orders

app = FastAPI()
app.include_router(orders.router)
```

<!-- e2e -->

```python title="app/orders/router.py"
from fastapi import APIRouter

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("/{order_id}")
async def get_order(order_id: int) -> dict[str, int]:
    return {"id": order_id}
```

<!-- e2e -->

```python title="app/invoices/router.py"
from fastapi import APIRouter

router = APIRouter(prefix="/invoices", tags=["invoices"])


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: int) -> dict[str, int]:
    return {"id": invoice_id}
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/invoices/router.py:3:10: FAPI003 APIRouter `app.invoices.router.router` has path operations, but no app includes it, directly or through another router, so its routes don't exist at runtime.
  fix: Include `router` in the app or router that serves its siblings.
    1. In app/main.py, which builds the app `app`, where its sibling routers are included: import `app.invoices.router.router` and add `app.include_router(...)` for it.
    2. If it is meant to stay unmounted (a later release, a test-only router), tell the user: they can add it to allow-unmounted in [tool.inwards.rules.router-wiring], or suppress this line with a reason.
    3. Don't delete the router or its routes to make this finding go away.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI003/
```

Poprawione: `main.py` dołącza oba routery.

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app.invoices import router as invoices
from app.orders import router as orders

app = FastAPI()
app.include_router(orders.router)
app.include_router(invoices.router)
```

<!-- e2e -->

```sh
inwards check app
```

## Jak działa { #how-it-works }

FAPI003 czyta wspólny model FastAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)) i buduje z niego graf aplikacji i routerów:

- **Korzenie:** każde `FastAPI(...)` w projekcie, także zbudowane w funkcji fabrykującej, takiej jak `create_app()`. Z `entrypoints` tylko aplikacje, które ta opcja wymienia.
- **Krawędzie:** każde wywołanie `include_router` i `mount`. Odbiorca i cel są rozwiązywane między plikami przez importy, nigdy przez import aplikacji: `router`, `invoices.router` po `from app import invoices`, `invoices_router` po `from app.invoices.router import router as invoices_router`, reeksport w `__init__.py` oraz każda nazwa z literału listy lub krotki, na której pętla `for` woła `include_router`.
- **Odbiorcy, których Inwards nie znajduje**, na przykład parametr `app` funkcji `register(app)`: to, co dołączają, liczy się jako osiągnięte, bo coś to dołącza.

Pliki są wybierane filtrem tekstowym (`fastapi`, `APIRouter`, `include_router`...) i parsowane raz. Graf powstaje tylko wtedy, gdy sprawdzany plik zawiera router, aplikację albo wywołanie `include_router`.

Gdzie działa:

- **`inwards check`**, `inwards baseline` i **Stop gate** zgłaszają wszystkie trzy rodzaje, ale tylko w plikach, które sprawdzają: częściowe sprawdzenie porównuje swoje pliki z grafem całego projektu. Stop gate sprawdza pliki zmienione w sesji, więc router utworzony lub zmieniony w sesji blokuje, jeśli na końcu wciąż nie jest podpięty, a router niepodpięty już na starcie sesji nie blokuje.
- **Hook PostToolUse** i edytor zgłaszają tylko to, co widać w jednym pliku: dołączenie nad trasami i router dołączający sam siebie. Utworzenie routera i podpięcie go w `main.py` to dwie edycje, a blokowanie pierwszej byłoby błędem.

Ten sam graf czytają reguły FastAPI, które potrzebują ścieżki dołączeń ([#183](https://github.com/SirCypkowskyy/inwards/issues/183), [#224](https://github.com/SirCypkowskyy/inwards/issues/224), [#227](https://github.com/SirCypkowskyy/inwards/issues/227)): `rules/fastapi/graph.ts`.

## Jak naprawić { #how-to-fix }

1. Niepodpięty router: dołącz go do aplikacji albo do routera nadrzędnego, w którym dołączane są jego routery siostrzane. Poprawka wskazuje ten moduł. Nie usuwaj routera.
2. Cykl: usuń jedno z wywołań `include_router`, które wymienia poprawka. Zostaw to, które prowadzi od routera bliższego aplikacji w dół, do jego dziecka.
3. Dołączony przed swoimi trasami: przenieś wywołanie `include_router` pod ostatni dekorator dołączanego routera albo do modułu, który buduje aplikację.

## Bezpieczeństwo poprawki { #fix-safety }

Brak automatycznej poprawki (`autofix: false`). To, gdzie router powinien być podpięty i które dołączenie w cyklu jest złe, to decyzje projektowe.

## Konfiguracja { #configuration }

Poziom: błąd. Reguła opt-in: włącza się ją przez `extend-select`. Jej opcje trafiają do `[tool.inwards.rules.router-wiring]`:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
extend-select = ["FAPI003"]

[tool.inwards.rules.router-wiring]
entrypoints = ["app.main:app"]
allow-unmounted = ["app.experimental"]
unresolved-includes = "warn"
check-order = true
```

- `entrypoints` (domyślnie: każda aplikacja): aplikacje, od których liczy się podpięcie routerów, w postaci `module:name`. Nazwa to zmienna aplikacji albo funkcja najwyższego poziomu, która ją buduje (`app.main:create_app`). Inne aplikacje, w testach czy skryptach, wtedy się nie liczą. Wpis, który nie wskazuje żadnej aplikacji, nic nie daje.
- `allow-unmounted` (domyślnie brak): routery, które mogą zostać niepodpięte, jako prefiksy modułów albo selektory (gramatyka `modules` warstwy) dopasowywane do kwalifikowanej nazwy routera, np. `app.experimental` albo `app.*.internal`.
- `unresolved-includes` (domyślnie `"warn"`): co robi wywołanie `include_router`, którego celu Inwards nie umie rozwiązać. `"warn"` zamienia każdy niepodpięty router w ostrzeżenie, które wskazuje to wywołanie; `"silent"` je pomija.
- `check-order` (domyślnie `true`): `false` wyłącza zgłaszanie dołączenia nad trasami.
- `modules`, jak w każdej regule ([tabele opcji](index.md#opt-in-rules)).

Każda diagnostyka ma własną linię i można ją wyciszyć w linii przez `# inwards: ignore[FAPI003] reason="..."` w tej linii. Wyciszenie w linii `APIRouter(...)` liczy się jako użyte także w hooku, który tego routera nie zgłasza.

## Znane ograniczenia { #known-limitations }

- **Dynamiczne podpinanie:** `importlib.import_module(...)`, `getattr(m, "router")`, pętla po czymś innym niż literał, router zwracany przez funkcję fabrykującą, pluginy z entry pointów. Wywołanie `include_router`, którego celu Inwards nie umie rozwiązać, zamienia niepodpięte routery w ostrzeżenia (albo w nic, z `"silent"`), nigdy w błędy oparte na zgadywaniu. Router biblioteki (`from fastapi_users import ...`) nie jest nierozwiązanym wywołaniem; po prostu nie ma go w grafie.
- **Warunkowe podpinanie:** `if settings.DEBUG: app.include_router(debug.router)` liczy się jako dołączenie.
- **Routery celowo nieużywane** (wspólny router dołączany przez inne pakiety, router tylko dla testów, router odłożony na kolejne wydanie): użyj `allow-unmounted` albo wyciszenia z powodem.
- **Aplikacje spoza projektu** nie są widoczne: router dołączany przez aplikację z biblioteki jest dla FAPI003 niepodpięty. Dla takiego kodu użyj `allow-unmounted` albo `ignore`.
- Cykl przez dynamiczne podpinanie nie jest widoczny. Cykl nie zawiesza FastAPI, bo dołączenie kopiuje trasy, ale zbiór tras zależy wtedy od kolejności wywołań, więc jest błędem.
- W Stop gate router, którego sesja nie dotknęła, nie jest zgłaszany, nawet jeśli sesja usunęła jego `include_router` z `main.py`. `inwards check` go zgłasza.

## Źródła { #references }

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): rodzina FastAPI, opt-in i wspólny model.
- Dokumentacja FastAPI, [Bigger Applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/): `include_router` na aplikacjach i routerach.
