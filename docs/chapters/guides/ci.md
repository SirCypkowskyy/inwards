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
