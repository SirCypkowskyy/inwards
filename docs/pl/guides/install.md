---
source: docs/chapters/guides/install.md
source_hash: 19fe4d06caa26dca8dc0684b0f818cf645edf94125466a8fa008b4185fa181c2
---

# Instalacja Inwards { #install-inwards }

!!! info "Zweryfikowano 2026-09-25"
    Budowanie ze źródeł i każde następne polecenie, ręcznie na Linuksie x64. Na macOS (arm64) i Windows CI uruchamia `init`, `check` i hook ze skompilowanym plikiem binarnym przed każdym wydaniem; ręczne sprawdzenie na tych systemach wciąż jest do zrobienia. Kroków z `curl` i `Invoke-WebRequest` nie da się wypróbować, dopóki repozytorium jest prywatne; `gh release download` działa.

Inwards to jeden plik wykonywalny, bez środowiska uruchomieniowego do instalowania. Najnowsze wydanie to wersja przedpremierowa v0.1.0-rc.1; pierwsze pełne wydanie przyjdzie z jednym z późniejszych kamieni milowych. Możesz też zbudować Inwards ze źródeł.

## Z wydania { #from-a-release }

Każde wydanie w [GitHub Releases](https://github.com/SirCypkowskyy/inwards/releases) ma jeden plik binarny na platformę, wheele platformowe, rozszerzenie VS Code (`.vsix`) i `SHA256SUMS`. Atestacje buildów dojdą, gdy repozytorium stanie się publiczne.

| Platforma | Plik |
|---|---|
| Linux x64 | `inwards-linux-x64` (glibc) albo `inwards-linux-x64-musl` (Alpine: najpierw `apk add libstdc++ libgcc`) |
| Linux arm64 | `inwards-linux-arm64` |
| macOS Apple silicon | `inwards-darwin-arm64` |
| macOS Intel | `inwards-darwin-x64` |
| Windows x64 | `inwards-windows-x64.exe` |

=== "Linux / macOS"

    ```sh
    VERSION=v0.1.0-rc.1; FILE=inwards-linux-x64   # pick your file from the table
    curl -LO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/$FILE"
    curl -LO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/SHA256SUMS"
    sha256sum --check --ignore-missing SHA256SUMS   # macOS: shasum -a 256 --check --ignore-missing SHA256SUMS
    mkdir -p ~/.local/bin && install -m 755 "$FILE" ~/.local/bin/inwards
    inwards --version
    ```

    Jeśli powłoka nie znajduje `inwards`, dodaj `~/.local/bin` do `PATH` w profilu powłoki (`export PATH="$HOME/.local/bin:$PATH"`).

    Dopóki repozytorium jest prywatne, GitHub odpowiada na te adresy kodem 404. Pobierz pliki przez GitHub CLI, a potem kontynuuj od linii z `sha256sum`:

    ```sh
    gh release download "$VERSION" --repo SirCypkowskyy/inwards --pattern "$FILE" --pattern SHA256SUMS
    ```

=== "Windows (PowerShell)"

    ```powershell
    $Version = "v0.1.0-rc.1"; $File = "inwards-windows-x64.exe"
    Invoke-WebRequest "https://github.com/SirCypkowskyy/inwards/releases/download/$Version/$File" -OutFile inwards.exe
    Invoke-WebRequest "https://github.com/SirCypkowskyy/inwards/releases/download/$Version/SHA256SUMS" -OutFile SHA256SUMS
    (Get-FileHash inwards.exe -Algorithm SHA256).Hash.ToLower()   # compare with the line for $File in SHA256SUMS
    .\inwards.exe --version
    ```

    Umieść `inwards.exe` w katalogu, który jest w `PATH`.

Gdy atestacje zostaną opublikowane, `gh attestation verify <file> --repo SirCypkowskyy/inwards` sprawdzi, czy plik binarny zbudował workflow wydań tego repozytorium.

## Jako zależność deweloperska uv { #as-a-uv-dev-dependency }

Każde wydanie ma też po jednym wheelu na platformę, z plikiem binarnym w środku, tak jak dystrybuowany jest Ruff (Linux z glibc, macOS i Windows; na Alpine użyj pliku binarnego). uv instaluje go jak każdy inny pakiet, a `inwards` trafia do środowiska wirtualnego projektu.

### Z PyPI (od pierwszego wydania na PyPI) { #from-pypi-from-the-first-pypi-release }

Na PyPI nie ma jeszcze żadnego wydania. Gdy się pojawi, instalacja zajmie jedną linię, a uv wybierze wheel dla każdej platformy:

```sh
uv add --dev inwards
uv run inwards check
uvx inwards --version   # one-off, no project
```

Do tego czasu `inwards` na PyPI to rezerwacja nazwy w wersji 0.0.0: `--version` mówi, że linter nie został jeszcze wydany, a każde inne polecenie kończy się kodem 2. Użyj wheeli z wydania na GitHubie, opisanych niżej. Wydania trafiają na PyPI przez [trusted publishing](../03-Architecture-C4.md#publishing-to-pypi); pierwsze przyjdzie z jednym z późniejszych kamieni milowych, nie z v0.1.0-rc.1.

`uv add --dev inwards` bierze najnowsze pełne wydanie i pomija wersje przedpremierowe. Żeby wypróbować wersję przedpremierową, która jest na PyPI, poproś o nią wprost: `uv add --dev "inwards>=0.2.0rc1"`.

### Z wydania na GitHubie { #from-a-github-release }

```sh
TAG=v0.1.0-rc.1; VER=0.1.0rc1   # the release, and its Python version
uv add --dev "inwards @ https://github.com/SirCypkowskyy/inwards/releases/download/$TAG/inwards-$VER-py3-none-manylinux_2_17_x86_64.whl"
uv run inwards check
uvx --from "https://github.com/SirCypkowskyy/inwards/releases/download/$TAG/inwards-$VER-py3-none-manylinux_2_17_x86_64.whl" inwards --version   # one-off, no project
```

Wybierz wheel dla swojej platformy: `manylinux_2_17_x86_64`, `manylinux_2_17_aarch64`, `macosx_13_0_arm64`, `macosx_13_0_x86_64` albo `win_amd64`. Zespołowi pracującemu na kilku platformach daj uv po jednym źródle na platformę w `pyproject.toml`. Wymień wszystkie pięć: na platformie, do której nie pasuje żaden znacznik, uv wraca do PyPI, a tam do pierwszego wydania na PyPI jest tylko rezerwacja nazwy.

```toml title="pyproject.toml"
[dependency-groups]
dev = ["inwards"]

[tool.uv.sources]
inwards = [
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-manylinux_2_17_x86_64.whl", marker = "sys_platform == 'linux' and platform_machine == 'x86_64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-manylinux_2_17_aarch64.whl", marker = "sys_platform == 'linux' and platform_machine == 'aarch64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-macosx_13_0_arm64.whl", marker = "sys_platform == 'darwin' and platform_machine == 'arm64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-macosx_13_0_x86_64.whl", marker = "sys_platform == 'darwin' and platform_machine == 'x86_64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-win_amd64.whl", marker = "sys_platform == 'win32'" },
]
```

Żaden znacznik nie odróżnia glibc od musl, więc na Alpine `uv sync` zatrzymuje się z komunikatem „incompatible platform”; tam użyj pliku binarnego.

!!! warning "Dopóki repozytorium jest prywatne"
    GitHub udostępnia pliki wydań prywatnego repozytorium tylko przez swoje API, którego uv nie potrafi wywołać, więc te adresy zwracają 404 nawet z tokenem. Pobierz wheele przez GitHub CLI i każ uv szukać w tym katalogu. uv wybierze wtedy wheel dla każdej platformy:

    ```sh
    gh release download v0.1.0-rc.1 --repo SirCypkowskyy/inwards --pattern '*.whl' --dir wheels
    ```

    ```toml title="pyproject.toml"
    [tool.uv]
    find-links = ["wheels"]
    prerelease = "allow"
    ```

    ```sh
    uv add --dev inwards
    uv run inwards --version
    ```

`inwards --version` wypisuje wydanie, z którego zbudowano plik binarny, bez przyrostka wersji przedpremierowej (`0.1.0` dla `0.1.0rc1`).

## Ze źródeł { #from-source }

Potrzebujesz [Buna](https://bun.sh) 1.4.2 (wersji z `.bun-version`) i dostępu do repozytorium.

```sh
git clone https://github.com/SirCypkowskyy/inwards && cd inwards
bun install
bun run build:cli bun-linux-x64          # or bun-darwin-arm64, bun-windows-x64, ...
mkdir -p ~/.local/bin && install -m 755 dist/inwards-linux-x64 ~/.local/bin/inwards
inwards --version
```

## Skonfiguruj warstwy { #configure-the-layers }

### Nowy projekt: zacznij od presetu { #a-new-project-start-from-a-preset }

`inwards init --style` zapisuje `[tool.inwards]` dla znanej architektury, a `--scaffold` dodaje mały przykładowy pakiet, który przechodzi sprawdzenie. Projekt tworzy uv; Inwards dodaje tylko warstwy:

```sh
uv init --package app && cd app
inwards init --style hexagonal --scaffold
```

```text
inwards init: wrote the hexagonal preset to pyproject.toml and 14 example files.

src/app/  (hexagonal)
├── adapters/
│   ├── inbound/   inbound: may import domain, application, outbound
│   └── outbound/  outbound: may import domain, application
├── application/   application: may import domain
├── bootstrap.py   bootstrap: may import every other layer
└── domain/        domain: imports no other layer

inwards check: 0 violations, 0 warnings.

Try the example: uv run python -m app.bootstrap book 2
Wire an agent: inwards init --agent claude|aider|agents-md
```

Gdy Inwards trafi na PyPI ([#32](https://github.com/SirCypkowskyy/inwards/issues/32)), druga linia zmieni się w `uvx inwards init --style hexagonal --scaffold` i nie trzeba będzie niczego wcześniej instalować.

Istnieją trzy presety, każdy z warstwami wymienionymi od najbardziej wewnętrznej. `inwards init --list-styles` wypisuje je razem z ich pakietami.

| Styl | Warstwy | Czego nie potrafi zabronić |
|---|---|---|
| `layered` | domain, persistence, services, presentation, bootstrap | presentation wywołującej persistence bezpośrednio (otwarte warstwy) |
| `clean` | domain, application, infrastructure, presentation, bootstrap | presentation importującej infrastructure |
| `hexagonal` | domain, application, outbound (`adapters.outbound`), inbound (`adapters.inbound`), bootstrap | adapterów inbound importujących adaptery outbound |

Każda warstwa może importować samą siebie i warstwy przed nią, więc konfiguracja złożona z samych warstw nie wyrazi luk z ostatniej kolumny; komentarz w tabeli `[tool.inwards]` nazywa tę lukę. `bootstrap.py` to korzeń kompozycji (composition root), jedyny moduł, który widzi każdą warstwę.

Co zapisuje `--style` i kiedy się zatrzymuje:

- **Tabela:** warstwy, `root` (`src` dla układu src, w przeciwnym razie `.`), `required-version`, domyślna lista `ignore` i komentarz z nazwą presetu i wersją Inwards. Pakiet pochodzi z `[project].name`, znormalizowanego tak jak robi to uv (`my-app` staje się `my_app`), albo z `--package`; słowo kluczowe Pythona nie może nim być. Uruchomiony w podkatalogu projektu, init używa najbliższego `pyproject.toml` powyżej i mówi, którego. Zanim pakiet powstanie, `root` to `src`, gdy backendem budowania jest uv_build albo gdy `src/` zawiera już kod w Pythonie.
- **Nigdy nie nadpisuje warstw.** Jeśli `[tool.inwards]` już istnieje, init kończy się kodem 2 i niczego nie zapisuje. Bez `pyproject.toml` kończy się kodem 2 i proponuje `uv init --package`.
- **`--scaffold`** zapisuje encję, port (`typing.Protocol`), przypadek użycia, adapter implementujący port, adapter sterujący z wiersza poleceń, korzeń kompozycji i jeden test w `tests/`. Nigdy niczego nie zastępuje: jeśli na drodze stoi plik albo dowiązanie symboliczne, albo katalog prowadzi przez dowiązanie poza projekt, init kończy się kodem 2, wypisuje ścieżki i niczego nie zapisuje. Istniejący `__init__.py`, taki jak ten tworzony przez uv, zostaje bez zmian. Najpierw zapisywane są pliki, a `pyproject.toml` na końcu; jeśli zapis się nie uda, init usuwa to, co utworzył, więc to samo polecenie można uruchomić ponownie.
- **`--dry-run`** wypisuje każdą zmianę jako diff i niczego nie zapisuje. **`--agent`** łączy się z `--style`: `inwards init --style clean --agent claude` zapisuje warstwy i hooki Claude Code w jednym uruchomieniu.
- Po zapisie init uruchamia sprawdzenie w tym samym procesie i wypisuje powyższe drzewo. Bez `--scaffold` każdy pakiet warstwy jest oznaczony `(missing)` i nie przechodzi sprawdzenia, dopóki nie będzie miał modułu.

W terminalu `inwards init` bez `--style` i bez `--agent` zadaje pytania: o styl (podświetlony pokazuje swoje warstwy), o to, czy dodać scaffold, i o to, którego agenta podłączyć. Na koniec wypisuje to samo polecenie z flagami. Bez terminala (stdin albo stdout nie jest TTY albo ustawiono `CI`) nigdy nie czeka na dane: od razu kończy się kodem 2 i wypisuje flagi oraz style. Agenci uruchamiają init właśnie w ten sposób.

### Dowolny projekt: napisz tabelę ręcznie { #any-project-write-the-table-by-hand }

Dodaj `[tool.inwards]` do `pyproject.toml` projektu, który chcesz sprawdzać, zaczynając od najbardziej wewnętrznej warstwy:

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain",         modules = ["shop.domain"] },
  { name = "application",    modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
```

Następnie sprawdź cały projekt:

<!-- e2e -->

```sh
inwards check
```

`All clear` z kodem wyjścia 0 oznacza, że każdy import wskazuje do środka. Przy kodzie wyjścia 1 polecenie wypisuje każde naruszenie z ponumerowanymi krokami naprawy, a kod wyjścia 2 to błąd użycia albo konfiguracji.

### Istniejący kod { #on-an-existing-codebase }

Kod, który już łamie swoje warstwy, nie przechodzi pierwszego sprawdzenia. Żeby mimo to wdrożyć Inwards, zaakceptuj to, co jest dziś, i blokuj tylko nowe naruszenia:

<!-- e2e -->

```sh
inwards baseline
git add inwards-baseline.json
```

`inwards baseline` sprawdza cały projekt w ramach jednej konfiguracji i zapisuje każde naruszenie do `inwards-baseline.json` obok jego `pyproject.toml`. Zacommituj ten plik: czytają go `inwards check`, hooki agentów i CI. W monorepo uruchom polecenie raz dla każdego pakietu, który ma własne `[tool.inwards]` (`inwards baseline --config packages/api/pyproject.toml`), bo każdy plik jest sprawdzany względem baseline'u leżącego obok jego konfiguracji. Zaakceptowany import może przenieść się do innej linii i nadal przechodzić, bo wpisy są dopasowywane po regule, module i komunikacie, bez zdania „Allowed direction” z komunikatu, więc dodanie warstwy nie sprawia, że wracają. Druga kopia tego samego importu w tym samym module nie przechodzi. Gdy sprawdzenie całego projektu stwierdzi, że zaakceptowanych naruszeń już nie ma, mówi o tym. Uruchom wtedy ponownie `inwards baseline`, żeby je usunąć. Z `--format json` i istniejącym baseline'em podsumowanie liczy jedno i drugie: `baselined` przy każdym uruchomieniu, `resolved` przy sprawdzeniu całego projektu. Agenci nie mogą edytować tego pliku ani uruchamiać tego polecenia: hooki Claude Code odrzucają jedno i drugie, a Stop gate oblewa sesję, która go zmieniła, i sprawdza pliki tej sesji zupełnie bez baseline'u.

Gdy projekt ma baseline, `stop-gate = "project"` w `[tool.inwards]` sprawia, że Stop gate w Claude Code sprawdza cały projekt względem baseline'u, a nie tylko pliki zmienione w sesji, więc naruszenie w dowolnym miejscu blokuje turę ([rozdział 4](../04-AI-Integration.md)). Sprawdzenie pomija parsowanie potwierdzające tam, gdzie baseline akceptuje wszystko, co znalazł prescan, więc w pełni pokryte baseline'em sprawdzenie kosztuje mniej więcej tyle, co czyste.

Następnie podłącz Inwards do swojego agenta: [Claude Code](claude-code.md), [Aider](aider.md) albo dowolny agent czytający [AGENTS.md](agents-md.md). Żeby pull requesty łamiące warstwę nie przechodziły, dodaj workflow [GitHub Actions](ci.md).
