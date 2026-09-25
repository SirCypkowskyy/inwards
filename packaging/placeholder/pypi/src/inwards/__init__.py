"""Placeholder that holds the `inwards` name on PyPI until wheels with the binary ship."""

import sys

MESSAGE = (
    "inwards 0.0.0 is an early placeholder, not the linter itself.\n"
    "Inwards, an architecture linter for Python, has not been released yet."
)


def main() -> None:
    """Say that the linter is not released yet; exit 2 for anything but --version.

    Exit 2 is "usage or config error", so a dependency bump to this placeholder
    fails CI and hooks loudly instead of passing every check.
    """
    if sys.argv[1:] == ["--version"]:
        print(MESSAGE)
        sys.exit(0)
    print(MESSAGE, file=sys.stderr)
    sys.exit(2)
