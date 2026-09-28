from src.exceptions import NotFound
from src.orders.constants import ErrorCode


class OrderNotFound(NotFound):
    code = ErrorCode.ORDER_NOT_FOUND
