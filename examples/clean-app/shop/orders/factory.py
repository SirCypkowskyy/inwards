"""Wires orders: adapters into commands and queries, those into the API."""

from shop.orders.adapters.in_memory_orders import InMemoryOrders
from shop.orders.api import OrdersApi
from shop.orders.commands.place_order import PlaceOrder
from shop.orders.ports import PriceList
from shop.orders.queries.order_summary import GetOrderSummary
from shop.shared.ports import Clock


def build_orders(prices: PriceList, clock: Clock) -> OrdersApi:
    """Orders backed by memory, priced from `prices`."""
    orders = InMemoryOrders()
    return OrdersApi(PlaceOrder(orders, prices, clock), GetOrderSummary(orders))
