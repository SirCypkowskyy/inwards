"""What an order costs."""

from shop.orders.models import Order
from shop.shared.models import Money


def order_total(order: Order) -> Money:
    """The sum of every line's price times its quantity."""
    total = Money(0)
    for line in order.lines:
        total += line.unit_price.times(line.quantity)
    return total
