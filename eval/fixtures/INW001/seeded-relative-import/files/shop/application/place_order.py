from ..domain.order import Order, place
from ..domain.ports import OrderRepository
from ..infrastructure.sql_orders import SqlOrderRepository


def handle(order_id: str, total_cents: int, repo: OrderRepository | None = None) -> Order:
    order = Order(order_id, total_cents)
    place(order, repo or SqlOrderRepository())
    return order
