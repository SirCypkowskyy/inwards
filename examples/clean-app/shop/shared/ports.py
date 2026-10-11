"""What the shared kernel needs from the outside world."""

from datetime import datetime
from typing import Protocol


class Clock(Protocol):
    """The current time, so tests can stop it."""

    def now(self) -> datetime: ...
