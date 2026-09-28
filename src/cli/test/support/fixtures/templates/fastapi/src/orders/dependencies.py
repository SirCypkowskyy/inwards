from src.orders import service
from src.orders.schemas import OrderOut


async def valid_order_id(order_id: int) -> OrderOut:
    return service.get_order(order_id)
