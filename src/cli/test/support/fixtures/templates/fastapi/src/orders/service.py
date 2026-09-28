from src.database import engine
from src.orders.exceptions import OrderNotFound
from src.orders.models import Order
from src.orders.schemas import OrderOut


def get_order(order_id: int) -> OrderOut:
    if engine is None:
        raise OrderNotFound()
    return OrderOut(id=Order(id=order_id).id)
