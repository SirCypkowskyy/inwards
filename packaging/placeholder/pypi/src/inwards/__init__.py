"""Placeholder that holds the `inwards` name on PyPI until wheels with the binary ship."""

import sys

MESSAGE = (
    "inwards 0.0.0 is a name placeholder, not the linter.\n"
    "Install the binary from https://github.com/SirCypkowskyy/inwards/releases"
)


def main() -> None:
    """Print where the real binary lives; exit 2 for anything but --version.

    Exit 2 is "usage or config error", so a dependency bump to this placeholder
    fails CI and hooks loudly instead of passing every check.
    """
    if sys.argv[1:] == ["--version"]:
        print(MESSAGE)
        sys.exit(0)
    print(MESSAGE, file=sys.stderr)
    sys.exit(2)
