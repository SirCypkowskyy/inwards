from typing import Protocol


class OrderRepository(Protocol):
    def save(self, order_id: str) -> None: ...
