---
source: docs/chapters/guides/diagrams.md
source_hash: f8b26139a5f3c7ddd6a8f2513b3e0ac0719a1965a6404eaabd92d4d5b4842082
---

# Diagramy architektury { #architecture-diagrams }

Inwards trzyma rysunek architektury w Mermaid w zgodzie z `[tool.inwards]`, w obie strony ([ADR-045](../05-ADR.md#adr-045-architecture-diagrams-are-checked-against-toolinwards-never-read-as-config)):

- **Dokumentacja idzie za kodem.** [INW017](../rules/INW017.md) zgłasza nazwę w diagramie, której nie zna konfiguracja albo kod, a [INW018](../rules/INW018.md) strzałkę, która rysuje import zabroniony przez konfigurację.
- **Dokumentacja steruje kodem.** `inwards import-diagram` zamienia diagram w pierwszą `[tool.inwards]`, jeden raz. Od tej chwili obie reguły trzymają je w zgodzie.

`[tool.inwards]` pozostaje jedynym źródłem prawdy: diagram nigdy nie jest czytany jako konfiguracja w czasie sprawdzania.

## Oznacz diagram { #mark-a-diagram }

Liczy się tylko `flowchart` albo `graph` w Mermaid, który zaczyna się od komentarza-znacznika, w pliku wymienionym w kluczu [`diagrams`](configuration.md#diagrams): blok kodu `mermaid` w Markdownie albo cały plik `.mmd`. Pozostałe bloki Mermaid to zwykła dokumentacja.

| W diagramie | `%% inwards: layers` | `%% inwards: contexts` |
|---|---|---|
| Identyfikator węzła | nazwa warstwy | poza subgraphem: nazwa kontekstu |
| Subgraph | (grupa, bez znaczenia) | kontekst; jego identyfikator to nazwa kontekstu |
| `id["pkg.module"]`, etykieta w cudzysłowie | prefiks modułu albo selektor warstwy | moduł kontekstu albo moduł wewnątrz niego |
| Ciągła strzałka `a --> b` | `a` może importować `b`, więc `b` jest wewnętrzna | kontekst `a` zależy od kontekstu `b` |
| `:::public` | | wpis `public` kontekstu; na samym kontekście cały kontekst |
| `:::external` | pomijany | pomijany |
| Przerywana `-.->`, bez grotu `---`, dwukierunkowa `<-->` | bez znaczenia | bez znaczenia |

Miejsce warstwy to najdłuższa ścieżka ciągłych strzałek od niej do warstwy, która na nic nie wskazuje; warstwy na tym samym miejscu są sąsiednie i nie mogą importować siebie nawzajem. Cykl ciągłych strzałek nie ma kolejności i jest odrzucany.

Warstwę albo kontekst, którego nazwa nie może być identyfikatorem Mermaid (`slices.domain` z szablonu), nazywa węzeł, którego etykieta w cudzysłowie jest jednym z jej wpisów `modules`.

## Sprawdzaj diagram { #check }

Wymień pliki i włącz reguły:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards]
diagrams = ["README.md", "docs/**/*.md", "docs/**/*.mmd"]

[tool.inwards.rules]
extend-select = ["INW017", "INW018"]
```

Obie reguły dają ostrzeżenia, więc rysunek, który się rozjechał, nie blokuje Stop gate agenta; `severity = { INW017 = "error", INW018 = "error" }` sprawia, że blokują. Działają przy sprawdzaniu całego projektu: `inwards check` bez ścieżek albo Stop gate z `stop-gate = "project"`.

## Zacznij od diagramu { #import-diagram }

Najpierw narysuj architekturę, a potem niech `import-diagram` zapisze konfigurację:

```sh
inwards import-diagram docs/architecture.md            # print the table on stdout, notes on stderr
inwards import-diagram docs/architecture.md --write    # append it to pyproject.toml
```

- **Wejście.** Jeden plik Markdown (każdy oznaczony blok `mermaid` w nim) albo jeden plik `.mmd`, z najwyżej jednym diagramem warstw i jednym diagramem kontekstów.
- **Wyjście.** Tabela wymienia plik w `diagrams` i włącza INW017 oraz INW018, więc diagram dalej jest sprawdzany. Plik spoza katalogu roboczego nie trafia do listy, bo wpisy `diagrams` nie mogą wychodzić wyżej przez `..`.
- **`--write`** dopisuje tabelę do `pyproject.toml` w katalogu roboczym. Odmawia, z kodem wyjścia 2 i bez zapisu, gdy nie ma `pyproject.toml` albo ma on już `[tool.inwards]`: nigdy niczego nie nadpisuje ani nie scala. Wtedy wypisz tabelę i scal ją ręcznie.
- **`root`.** Gdy pakiety leżą w `src/`, tabela dostaje `root = "src"`, tak jak wybrałoby `inwards init`.
- **Najpierw sprawdzenie.** Tabela musi się dać przeczytać jako konfiguracja Inwards, inaczej polecenie kończy się kodem wyjścia 2 i mówi dlaczego: dwie warstwy z tą samą etykietą w cudzysłowie, węzeł `public` poza modułem swojego kontekstu.

Co jest odrzucane, z numerem linii: cykl między warstwami; kontekst albo węzeł `:::public` bez etykiety w cudzysłowie, bo kontekst wymaga modułów; drugi diagram tego samego rodzaju w pliku. Warstwa bez etykiety w cudzysłowie dostaje `modules = []` i uwagę na stderr: uzupełnij ją przed sprawdzeniem. Plik tylko z diagramem kontekstów dostaje jedną warstwę, `app`, która obejmuje każdy kontekst.

## Przykład { #an-example }

Projekt z czterema pakietami i jeszcze bez konfiguracji:

<!-- e2e -->

```toml title="pyproject.toml"
[project]
name = "shop"
version = "0.1.0"
```

<!-- e2e -->

```python title="shop/domain/order.py"
class Order:
    pass
```

<!-- e2e -->

```python title="shop/orders/place.py"
from shop.domain.order import Order
```

<!-- e2e -->

```python title="shop/billing/invoice.py"
from shop.domain.order import Order
```

<!-- e2e -->

```python title="shop/api/routes.py"
from shop.orders.place import Order
```

Warstwy tak, jak rysuje je zespół, z zamówieniami i rozliczeniami obok siebie:

<!-- e2e -->

```text title="docs/layers.mmd"
%% inwards: layers
flowchart TD
  api["shop.api"] --> orders["shop.orders"] & billing["shop.billing"]
  orders --> domain["shop.domain"]
  billing --> domain
  api --> db[("Postgres")]:::external
```

<!-- e2e -->

```sh
inwards import-diagram docs/layers.mmd
```

<!-- e2e -->

```text
# Converted from docs/layers.mmd by inwards import-diagram.
[tool.inwards]
diagrams = ["docs/layers.mmd"]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  [
    { name = "orders", modules = ["shop.orders"] },
    { name = "billing", modules = ["shop.billing"] },
  ],
  { name = "api", modules = ["shop.api"] },
]

[tool.inwards.rules]
extend-select = ["INW017", "INW018"]
inwards import-diagram: read 4 layers and 0 contexts from docs/layers.mmd.
```

`domain` na nic nie wskazuje, więc jest najbardziej wewnętrzna; `orders` i `billing` wskazują tylko na nią, więc dzielą następne miejsce i są sąsiednie; `api` jest najbardziej zewnętrzna. Baza danych jest `:::external` i nie zostaje warstwą. Zapisz i sprawdź:

<!-- e2e -->

```sh
inwards import-diagram docs/layers.mmd --write
inwards check
```

Projekt przechodzi, razem z diagramem. Gdyby później ktoś narysował strzałkę z `orders` do `billing`, byłoby to INW018, a import w kodzie między nimi INW001.

Diagram kontekstów działa tak samo. Ten

```text title="docs/contexts.mmd"
%% inwards: contexts
flowchart LR
  subgraph sales["shop.sales"]
    checkout["shop.sales.checkout"]
  end
  subgraph catalog["shop.catalog"]
    api["shop.catalog.api"]:::public
  end
  checkout --> api
```

zamienia się w:

<!-- config: fragment -->

```toml
[[tool.inwards.contexts]]
name = "sales"
modules = ["shop.sales"]
public = []
depends-on = ["catalog"]

[[tool.inwards.contexts]]
name = "catalog"
modules = ["shop.catalog"]
public = ["shop.catalog.api"]
depends-on = []
```

## Ograniczenia { #limits }

- **Tylko flowcharty Mermaid.** Diagramy C4, `architecture-beta` i PlantUML nie są jeszcze czytane.
- **To, czego Mermaid nie wyrazi, zostaje poza tabelą.** Listy bibliotek, kształty, selektory inne niż etykieta węzła, opcje reguł i `ignore` dopisuje się ręcznie po imporcie.
- **Importy, których diagram nie rysuje**, nie są jeszcze zgłaszane; to będzie INW019 ([#332](https://github.com/SirCypkowskyy/inwards/issues/332)).
- **Tylko uruchomienia dla całego projektu.** Hook po edycji i edytor nie pokazują zgłoszeń z diagramów.
