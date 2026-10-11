"""Orders kept in a dict, for the demo and for tests."""

from typing import TYPE_CHECKING

from shop.orders.models import Order


class InMemoryOrders:
    """An order repository that forgets everything on exit."""

    def __init__(self) -> None:
        self._rows: dict[str, Order] = {}

    def save(self, order: Order) -> None:
        self._rows[order.id] = order

    def get(self, order_id: str) -> Order | None:
        return self._rows.get(order_id)


if TYPE_CHECKING:
    from shop.orders.ports import OrderRepository

    _: OrderRepository = InMemoryOrders()
