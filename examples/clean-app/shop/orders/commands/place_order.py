"""Place an order at today's prices."""

from shop.orders.models import Order, OrderLine
from shop.orders.ports import OrderRepository, PriceList
from shop.shared.ports import Clock


class PlaceOrder:
    """Prices each line from the price list and stores the order."""

    def __init__(self, orders: OrderRepository, prices: PriceList, clock: Clock) -> None:
        self._orders = orders
        self._prices = prices
        self._clock = clock

    def __call__(self, order_id: str, quantities: dict[str, int]) -> Order:
        if not quantities:
            msg = "an order needs at least one line"
            raise ValueError(msg)
        lines = tuple(
            OrderLine(sku, quantity, self._prices.price_of(sku))
            for sku, quantity in quantities.items()
        )
        order = Order(order_id, lines, self._clock.now())
        self._orders.save(order)
        return order
