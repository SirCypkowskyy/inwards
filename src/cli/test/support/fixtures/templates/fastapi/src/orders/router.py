from fastapi import APIRouter, Depends

from src.orders.dependencies import valid_order_id
from src.orders.schemas import OrderOut
from src.users import service as users_service

router = APIRouter(prefix="/orders")


@router.get("/{order_id}")
async def get_order(order: OrderOut = Depends(valid_order_id)) -> OrderOut:
    users_service.get_user(order.id)
    return order
