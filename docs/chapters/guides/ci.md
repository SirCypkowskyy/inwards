# GitHub Actions

!!! info "Verified 2026-09-26"
    The check and annotation steps run on every pull request in this repository ([`sarif.yml`](https://github.com/SirCypkowskyy/inwards/blob/develop/.github/workflows/sarif.yml), on `examples/broken-app`), with Inwards built from source. The upload to code scanning can't be tried while the repository is private (see below), and neither can the `curl` install step.

Agent hooks catch a violation while the agent works; CI catches the ones that get past them, such as a hand edit or an agent without hooks. The workflow below fails the pull request when an import breaks a layer and puts the violation on the line that caused it.

## The workflow

Save it as `.github/workflows/inwards.yml`:

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
      - name: Install Inwards
        env:
          VERSION: v0.1.0-rc.1
          FILE: inwards-linux-x64
        run: |
          curl -fsSLO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/$FILE"
          curl -fsSLO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/SHA256SUMS"
          sha256sum --check --ignore-missing SHA256SUMS
          install -D -m 755 "$FILE" "$RUNNER_TEMP/bin/inwards"
          echo "$RUNNER_TEMP/bin" >> "$GITHUB_PATH"
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

- **Check** writes SARIF 2.1.0 and records the exit code instead of failing, so the next steps still run. Exit code 2 (no config, bad config) fails at once. The check reads `inwards-baseline.json` if you committed one, so on a legacy codebase only new violations fail; `inwards baseline` needs a release newer than v0.1.0-rc.1.
- **Annotate the pull request** turns each result into a [workflow command](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands). The violation shows on its line under "Files changed" and in the run summary, with the fix steps as the message. It needs no code scanning. GitHub shows at most 10 error annotations per step and 50 per job. Paths come from the SARIF, where they are URI-encoded, so a file whose name has a space or a non-ASCII character is annotated in the run summary rather than on its line.
- **Upload to code scanning** sends the same file to [GitHub code scanning](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github). Alerts get a history, a dismiss button and the rule's help link. Code scanning shows new alerts on a pull request by comparing it with the base branch, hence the `push` trigger.
- **Fail on violations** fails the job last, after the findings are out.

Keep one of the two annotation steps once code scanning works, or each violation shows twice.

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

`inwards check` and `inwards baseline` parse a large project on several threads: from 1,000 files on, one thread per 500 files, up to half the runner's cores and at most 4. The rules still run on one thread in file order, so the output is the same with any number of threads. On a 4,324-file Django service a cold check went from 1.48 s to 0.98 s with four threads on a 10-core Mac. On Linux the gain is smaller, and a 4-core runner gets two threads, which mostly help a repo where many files need a full parse ([chapter 6](../06-Constraints-and-Quality.md#worker-threads-for-a-full-run)). Each thread holds its own copy of the parser, about 40 to 50 MB.

- `INWARDS_THREADS=1` keeps the check on one thread, for a runner short of memory or a measurement that should use one core.
- `INWARDS_THREADS=N` allows up to N threads, past the default cap too. Eight were no faster than four in our measurements, because reading the files and the rules don't spread.
- The Claude Code hooks check a few files at a time and never start threads.

## Code scanning availability

Code scanning is free on public repositories. On a private repository it needs GitHub Code Security (part of GitHub Advanced Security), which only organizations on GitHub Team or Enterprise can buy. Without it, the upload step fails with "Code scanning is not enabled for this repository". Then either delete the upload step and rely on the annotation step, or add `continue-on-error: true` to it, as this repository does while it is private (`continue-on-error: ${{ github.event.repository.private }}`).

## While Inwards is private

The release URLs return 404 until the repository is public (see [Install](install.md#from-a-release)). Until then, download the binary with the GitHub CLI and a token that can read `SirCypkowskyy/inwards`, stored as a repository secret:

```yaml
      - name: Install Inwards
        env:
          GH_TOKEN: ${{ secrets.INWARDS_READ_TOKEN }}
        run: |
          gh release download v0.1.0-rc.1 --repo SirCypkowskyy/inwards --pattern inwards-linux-x64 --pattern SHA256SUMS
          sha256sum --check --ignore-missing SHA256SUMS
          install -D -m 755 inwards-linux-x64 "$RUNNER_TEMP/bin/inwards"
          echo "$RUNNER_TEMP/bin" >> "$GITHUB_PATH"
```

If the project already takes Inwards as a uv dev dependency, `uv run inwards check` works in place of the install step.
