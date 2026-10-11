---
source: docs/chapters/rules/roles/index.md
source_hash: 19c9671e92df2a0d53bc195384e93be85801a56d1ae947ea0f46d52a51879f56
---

# Role { #roles }

Co robi kod w modułach danej roli: endpointy przekazują pracę dalej, w `async def` nie ma blokujących wywołań, porty są abstrakcyjne, adaptery deklarują swój port, jest jeden korzeń kompozycji, nazwy ORM trzymają konwencję. Te reguły oceniają kod według wyborów zespołu, więc są opt-in; [szablon](../../guides/configuration.md#template-rules) może włączyć regułę dla roli, a niektóre presety też je włączają.

<div class="inw-rule-category" markdown>

| Kod | Nazwa | Co zgłasza | Włączona |
|---|---|---|---|
| [INW012](../INW012.md) | `thin-endpoint` | Endpoint HTTP, który sam wykonuje pracę: za dużo instrukcji, gałęzi albo pętli, własne wywołania bazy danych albo HTTP, albo brak wywołania warstwy, którą wskazuje `delegate-to` | opt-in |
| [INW013](../INW013.md) | `async-blocking` | Synchroniczne wywołanie bazy danych, cache'u albo chmury wewnątrz `async def`: synchroniczny `Session` SQLAlchemy, `redis.Redis`, boto3 albo blokujący sterownik | opt-in |
| [INW014](../INW014.md) | `ports-abstract` | Klasa w module portu, która nie jest ABC ani Protocol, albo metoda portu, której ciało wykonuje pracę | opt-in |
| [INW015](../INW015.md) | `construct-only-in` | Moduł spoza korzenia kompozycji, który w czasie działania importuje adapter wyjściowy albo inną chronioną rolę lub buduje jedną z jej klas | opt-in |
| [INW016](../INW016.md) | `orm-naming` | Nazwa tabeli, która nie jest w lower_case_snake i w liczbie pojedynczej, albo kolumna daty i czasu bez `_at` lub `_date`; uruchomienie dla całego projektu wymaga też konwencji nazw w `MetaData` | opt-in |
| [INW020](../INW020.md) | `adapter-conformance` | Publiczna klasa w module adaptera bez linii `_: Port = Adapter(...)` pod `if TYPE_CHECKING:`, taka linia wykonywana przy imporcie albo linia, której adnotacja nie nazywa żadnego portu | opt-in |

</div>

[Lista reguł](../index.md) zbiera reguły wszystkich kategorii w jednym miejscu; można ją przeszukiwać, filtrować i sortować.
