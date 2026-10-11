from ..domain.order import Order, place
from ..domain.ports import OrderRepository


def handle(order_id: str, total_cents: int, repo: OrderRepository) -> Order:
    order = Order(order_id, total_cents)
    place(order, repo)
    return order
