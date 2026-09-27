from shop.application.ports.order_repository import OrderRepository
from shop.domain.model.order import Order


def place_order(repo: OrderRepository) -> Order:
    order = Order()
    repo.add(order)
    return order
