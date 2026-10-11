"""Read an order back as a summary."""

from dataclasses import dataclass
from datetime import datetime

from shop.orders.ports import OrderRepository
from shop.orders.services import order_total
from shop.shared.models import Money


@dataclass(frozen=True)
class OrderSummary:
    """What a customer sees about an order."""

    id: str
    items: int
    total: Money
    placed_at: datetime


class GetOrderSummary:
    """Summarises one stored order."""

    def __init__(self, orders: OrderRepository) -> None:
        self._orders = orders

    def __call__(self, order_id: str) -> OrderSummary | None:
        order = self._orders.get(order_id)
        if order is None:
            return None
        items = sum(line.quantity for line in order.lines)
        return OrderSummary(order.id, items, order_total(order), order.placed_at)
