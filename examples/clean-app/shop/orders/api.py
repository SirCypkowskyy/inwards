"""What the rest of the shop may call in orders."""

from shop.orders.commands.place_order import PlaceOrder
from shop.orders.queries.order_summary import GetOrderSummary, OrderSummary


class OrdersApi:
    """The orders' entry point."""

    def __init__(self, place_order: PlaceOrder, get_summary: GetOrderSummary) -> None:
        self._place_order = place_order
        self._get_summary = get_summary

    def place(self, order_id: str, quantities: dict[str, int]) -> str:
        return self._place_order(order_id, quantities).id

    def summary(self, order_id: str) -> OrderSummary | None:
        return self._get_summary(order_id)
