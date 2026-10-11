"""The orders' entities."""

from dataclasses import dataclass
from datetime import datetime

from shop.shared.models import Money


@dataclass(frozen=True)
class OrderLine:
    """One product in an order, priced when the order was placed."""

    sku: str
    quantity: int
    unit_price: Money


@dataclass(frozen=True)
class Order:
    """A placed order."""

    id: str
    lines: tuple[OrderLine, ...]
    placed_at: datetime
