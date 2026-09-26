# Security policy

## Supported versions

Inwards is pre-1.0. Only the latest release gets security fixes.

## Reporting a vulnerability

Don't put the details in a public issue.

- **Once the repository is public:** report it privately through GitHub,
  [Security → Report a vulnerability](https://github.com/SirCypkowskyy/inwards/security/advisories/new).
  The report stays visible only to you and the maintainer until an advisory is
  published.
- **Until then** (GitHub offers private reporting on public repositories
  only): open an issue titled "Security contact request", with no details,
  and the maintainer will reach out to you privately.

Include the version (`inwards --version`), the platform, and the steps or files
that reproduce it. Examples of what counts: code execution from a config file
or a scanned Python file, a way for an agent to change `[tool.inwards]` past the
config guard, and a tampered release binary or wheel.
