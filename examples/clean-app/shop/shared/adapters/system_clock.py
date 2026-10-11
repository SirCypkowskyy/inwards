"""The real clock."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING


class SystemClock:
    """Reads the system time, in UTC."""

    def now(self) -> datetime:
        return datetime.now(UTC)


if TYPE_CHECKING:
    from shop.shared.ports import Clock

    _: Clock = SystemClock()
