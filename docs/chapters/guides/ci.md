# GitHub Actions

!!! info "Verified 2026-10-11"
    `inwards check --format github` is pinned by an E2E snapshot, its escaping by unit tests against the rules `@actions/core` uses; it hasn't yet run inside a GitHub Actions job. The code scanning workflow's check, annotation and upload steps run on every pull request in this repository ([`sarif.yml`](https://github.com/SirCypkowskyy/inwards/blob/develop/.github/workflows/sarif.yml), on `examples/broken-app`), with Inwards built from source. The install step's `uv tool install` was run by hand with 0.5.0 from PyPI, outside GitHub Actions. The pre-commit hook was run with `uvx pre-commit run --all-files` (pre-commit 4.6.2) and `inwards==0.5.0` on a scratch project.

Agent hooks catch a violation while the agent works; CI catches the ones that get past them, such as a hand edit or an agent without hooks. The workflow below fails the pull request when an import breaks a layer and puts the violation on the line that caused it.

## The workflow

!!! warning "Needs the release after 0.5.0"
    `--format github` is new: Inwards 0.5.0 exits 2 with `Unknown --format github`. Until the next release is on PyPI, use the [code scanning workflow](#code-scanning), which works with 0.5.0 and annotates the pull request without code scanning too.

Save it as `.github/workflows/inwards.yml`:

```yaml title=".github/workflows/inwards.yml"
name: Inwards

on: pull_request

permissions:
  contents: read

jobs:
  inwards:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10.2.0
      - name: Install Inwards
        run: |
          uv tool install 'inwards>0.5.0' # then pin the release you tested: inwards==X.Y.Z
          uv tool dir --bin >> "$GITHUB_PATH"
      - name: Check
        run: inwards check --format github
```

- **Install Inwards** takes the wheel from [PyPI](https://pypi.org/project/inwards/). Pin the version so a new release, which may add a rule, never fails a pull request that changed nothing; bump it in its own pull request. If the project already takes Inwards as a uv dev dependency, `uv sync` and `uv run inwards check --format github` use the version in `uv.lock`. Without uv, download the binary as in [Install](install.md#from-a-release) instead.
- **Check** prints one [workflow command](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands) per finding, `::error` for a violation and `::warning` for a warning, then the usual summary line. The runner turns each command into an annotation: the violation shows on its line under "Files changed" and in the run summary, with the fix steps and the rule's docs link as the message. It needs no code scanning and no `jq`. The exit code is the same as in every other format: 0 clean or warnings only, 1 with violations, 2 for a usage or config error, so the step fails the job by itself. The check reads `inwards-baseline.json` if you committed one, so on a legacy codebase only new violations fail.
- GitHub shows at most 10 error annotations per step and 50 per job. The rest are still in the step's log. `--max-diagnostics N` caps the commands too, errors first.

A line looks like this:

```text
::error file=shop/domain/order.py,line=1,endLine=1,col=8,endColumn=30,title=INW001::Layer "domain" imports "shop.infrastructure.db" from outer layer "infrastructure". ...%0AFix: ...
```

The message and the property values are escaped as GitHub's own toolkit escapes them (`escapeData` and `escapeProperty` in [`@actions/core`](https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts)): `%`, carriage return and line feed become `%25`, `%0D` and `%0A` everywhere, and in `file` and `title` a `:` becomes `%3A` and a `,` becomes `%2C`. A path with a comma or a colon in it still lands on its line. For a finding that spans several lines the command gives `line` and `endLine` without columns, since the runner drops columns when the two lines differ.

### Monorepos { #monorepos }

GitHub matches an annotation's `file` against paths from the repository root. When the check runs in a package folder, set the step's `working-directory`; Inwards reads `GITHUB_WORKSPACE`, the checkout's root on the runner, and writes each path from there:

```yaml
      - name: Check the API package
        working-directory: packages/api
        run: inwards check --format github
```

Run from `packages/api`, a violation in `shop/domain/order.py` is annotated as `packages/api/shop/domain/order.py`. At a uv workspace root, a plain `inwards check --format github` checks every member against its own config, and the paths are already relative to the root. Two cases still miss the line: an `actions/checkout` with `path:`, which puts the repository in a subfolder of `GITHUB_WORKSPACE`, so every path starts with that folder; and a run from outside `GITHUB_WORKSPACE`, where the paths stay relative to the working directory. The annotation then shows in the run summary only.

## Code scanning { #code-scanning }

[GitHub code scanning](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github) gives each alert a history, a dismiss button and the rule's help link. It reads SARIF, so this workflow writes `--format sarif` and annotates the pull request from that file with `jq`, which works with Inwards 0.5.0 as well:

```yaml title=".github/workflows/inwards.yml"
name: Inwards

on:
  pull_request:
  push:
    branches: [main] # code scanning compares a PR with its base branch's last analysis

permissions:
  contents: read

jobs:
  inwards:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read # upload-sarif, private repositories only
      security-events: write # upload-sarif
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10.2.0
      - name: Install Inwards
        run: |
          uv tool install inwards==0.5.0 # pin the release; bump it on purpose
          uv tool dir --bin >> "$GITHUB_PATH"
      - name: Check
        id: check
        run: |
          status=0
          inwards check --format sarif > inwards.sarif || status=$?
          echo "status=$status" >> "$GITHUB_OUTPUT"
          test "$status" -le 1 # 2 is a usage or config error: fail now
      - name: Annotate the pull request
        run: |
          jq -r '.runs[].results[] | .locations[0].physicalLocation as $l
            | "::\(if .level == "error" then "error" else "warning" end) file=\($l.artifactLocation.uri),line=\($l.region.startLine),col=\($l.region.startColumn),title=\(.ruleId)::\(.message.text | gsub("%"; "%25") | gsub("\r"; "%0D") | gsub("\n"; "%0A"))"' inwards.sarif
      - name: Upload to code scanning
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: inwards.sarif
          category: inwards
      - name: Fail on violations
        if: steps.check.outputs.status == '1'
        run: exit 1
```

- **Check** writes SARIF 2.1.0 and records the exit code instead of failing, so the next steps still run. Exit code 2 (no config, bad config) fails at once.
- **Annotate the pull request** does what `--format github` does, from the SARIF. Paths come from the SARIF, where they are URI-encoded and relative to the working directory, so a file whose name has a space or a non-ASCII character is annotated in the run summary rather than on its line. With a release after 0.5.0, replace this step with `inwards check --format github || true` to get exact paths.
- **Upload to code scanning** sends the same file to code scanning. Code scanning shows new alerts on a pull request by comparing it with the base branch, hence the `push` trigger.
- **Fail on violations** fails the job last, after the findings are out.

Keep one of the two annotation steps once code scanning works, or each violation shows twice.

## pre-commit { #pre-commit }

To check before each commit with [pre-commit](https://pre-commit.com/), add a local hook to `.pre-commit-config.yaml`. pre-commit installs the pinned wheel from PyPI into its own environment, so the project needs no other setup:

```yaml title=".pre-commit-config.yaml"
repos:
  - repo: local
    hooks:
      - id: inwards
        name: inwards
        entry: inwards check --format concise
        language: python
        additional_dependencies: ["inwards==0.5.0"]
        pass_filenames: false
        files: (\.py|pyproject\.toml|inwards-baseline\.json)$
```

- `pass_filenames: false` checks the whole project, so the whole-project rules (dead layer prefixes, import cycles, symlinks in layers) run too, and a commit that only touches `pyproject.toml` is checked against the new config. A cold whole check of the 496,000-line benchmark repo takes 0.4 s on one core ([chapter 6](../06-Constraints-and-Quality.md)). To check only the staged files, drop the line; the whole-project rules then wait for CI.
- `files` runs the hook when a Python file, a `pyproject.toml` or the baseline changes, and skips it otherwise.
- `--format concise` prints one line per finding. A violation fails the hook with exit 1, which stops the commit; a warning doesn't.
- Bump `inwards==0.5.0` on purpose, as in CI. A local hook has no `rev`, so `pre-commit autoupdate` leaves it alone.
- When Inwards is already a uv dev dependency, `entry: uv run inwards check --format concise` with `language: system` uses the locked version instead, and no `additional_dependencies`.

## Generated modules

A CI job checks a fresh checkout, which has only what is committed. Modules that a build step writes, such as protoc's `orders_pb2.py` and `orders_pb2_grpc.py` or the `_version.py` that setuptools-scm and hatch-vcs write, exist in a developer's checkout but not there. INW010 reports an import of a first-party module that isn't on disk, so it treats the modules `generated` in `[tool.inwards]` covers as existing, file or no file. Without the key the list is `["*_pb2", "*_pb2_grpc", "_version"]`, so protoc and version modules need no config. For another generator, list every pattern you need, since the key replaces the default:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards]
generated = ["*_pb2", "*_pb2_grpc", "_version", "shop.api.gen"]
```

- A pattern is a dotted module name, and each segment may use `*` and `?`. It matches whole segments anywhere in the module name, as `ignore` does: `*_pb2` covers `shop.api.orders_pb2`, `_version` covers `shop._version`, and `shop.api.gen` covers everything under `shop/api/gen/`. A `*` never crosses a dot.
- An empty segment, a character that can't be in a module name (a bracket set such as `[a-z]` included), or a pattern made only of wildcards (`*`, `*.*`) is a config error, and the check exits 2. To turn INW010 off, use `ignore = ["INW010"]` in `[tool.inwards.rules]`.
- `generated = []` turns the default off. Then run the generator (`python -m grpc_tools.protoc ...`) before `inwards check`, or INW010 reports every import of a module it writes.
- Only INW010 reads the key. The other rules see a generated module that isn't on disk as missing: an outward import of one is still INW001, and INW006 names the nearest package that exists. The Architecture chapter's [known limitations](../03-Architecture-C4.md#known-limitations) list the cases where that makes a finding differ between the two checkouts.
- The config guard denies an agent's edit of the key, as for every key in `[tool.inwards]`.

## Caching between runs

`inwards check` and `inwards baseline` keep what they read out of each file (its imports and suppression comments) in `.inwards/cache`, next to the `pyproject.toml`. An entry is found by a hash of the file's content, its module name and the Inwards version's extraction rules, so an edited file is simply read again. On the 2,100-file benchmark repo a warm cache made a full check 2.6 to 3 times faster; the run that fills it was a quarter to two thirds slower, depending on the filesystem. To keep the cache between workflow runs, restore it before **Check**:

```yaml
      - uses: actions/cache@v6
        with:
          path: .inwards/cache
          key: inwards-${{ runner.os }}-${{ github.sha }}
          restore-keys: inwards-${{ runner.os }}-
```

- **The cache is trusted, not checked.** A cached check believes what an entry says a file imports. Anyone who can write `.inwards/cache` can make it miss a violation, and a pull request can commit a `.inwards/cache` of its own. Where the check is the gate for code you don't trust, run `inwards check --no-cache`, or set `INWARDS_NO_CACHE=1` for the job. The Claude Code hooks never read the cache, so this doesn't touch the agent loop ([ADR-031](../05-ADR.md#adr-031-a-content-keyed-extraction-cache-that-the-hooks-never-read)).
- **It stays small.** A run prunes each of the cache's 256 parts when it first writes there, and again whenever its own writes take the part past 512 KB: entries older than 30 days go, then the oldest ones until the part is under the limit. That keeps a namespace (one folder under `.inwards/cache`) near 128 MB at most. An Inwards version whose extraction rules changed gives every file a new key in the same namespace, so the old entries age out or are pushed out. A new cache format or new grammars start a new namespace; the old folder is no longer read and stays until you delete it.
- **Nothing to configure.** Delete `.inwards/cache` whenever you like. `inwards init` already adds `.inwards/` to `.gitignore`.

## Threads

`inwards check` and `inwards baseline` parse a large project on several threads: from 1,000 files on, one thread per 500 files, up to half of the runner's cores beyond two and at most 4. The rules still run on one thread in file order, so the output is the same with any number of threads. On a 4,324-file Django service a cold check went from 1.48 s on one thread to 0.87 s with four threads on a 10-core arm64 macOS laptop ([#281](https://github.com/SirCypkowskyy/inwards/issues/281) cut the reading before the parse). On Linux the gain is smaller, and a 4-core runner, such as GitHub's hosted `ubuntu-latest`, keeps one thread, because more made the check slower there ([chapter 6](../06-Constraints-and-Quality.md#worker-threads-for-a-full-run)). Each thread holds its own copy of the parser, about 40 to 50 MB.

- `INWARDS_THREADS=1` keeps the check on one thread, for a runner short of memory or a measurement that should use one core.
- `INWARDS_THREADS=N` allows up to N threads, past the default cap too. Eight were no faster than four in our measurements, because the rules don't spread.
- The Claude Code hooks check a few files at a time and never start threads.

## Code scanning availability

Code scanning is free on public repositories. On a private repository it needs GitHub Code Security (part of GitHub Advanced Security), which only organizations on GitHub Team or Enterprise can buy. Without it, the upload step fails with "Code scanning is not enabled for this repository". Then either use [the workflow](#the-workflow) without code scanning, or add `continue-on-error: true` to the upload step.
