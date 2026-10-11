"""Value objects every slice uses."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Money:
    """An amount in cents, so sums never round."""

    cents: int

    def __add__(self, other: "Money") -> "Money":
        return Money(self.cents + other.cents)

    def times(self, quantity: int) -> "Money":
        """The price of `quantity` items at this price."""
        return Money(self.cents * quantity)
