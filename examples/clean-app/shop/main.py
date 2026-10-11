"""The composition root: builds every slice and hands each the ports it needs.

Run it from examples/clean-app with `python -m shop.main`.
"""

from dataclasses import dataclass

from shop.catalog.api import CatalogApi
from shop.catalog.factory import build_catalog
from shop.orders.api import OrdersApi
from shop.orders.factory import build_orders
from shop.shared.adapters.system_clock import SystemClock


@dataclass(frozen=True)
class Shop:
    """Every slice's API, wired."""

    catalog: CatalogApi
    orders: OrdersApi


def build_shop() -> Shop:
    """The catalog is the orders' price list; the type checker checks the fit."""
    catalog = build_catalog()
    return Shop(catalog, build_orders(prices=catalog, clock=SystemClock()))


if __name__ == "__main__":
    shop = build_shop()
    shop.catalog.add("tea", "Green tea", price_cents=450, discount_percent=10)
    shop.orders.place("o-1", {"tea": 3})
    print(shop.orders.summary("o-1"))
