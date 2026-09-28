from src.orders.config import PAGE_SIZE


def pages(count: int) -> int:
    return -(-count // PAGE_SIZE)
