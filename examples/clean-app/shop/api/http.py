from shop.application.place_order import handle
from shop.infrastructure.sql_orders import SqlOrderRepository


def post_order(order_id: str, total_cents: int) -> dict[str, str]:
    order = handle(order_id, total_cents, SqlOrderRepository())
    return {"id": order.id}
