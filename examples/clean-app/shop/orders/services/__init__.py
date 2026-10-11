"""Order rules. Import them from here; the `_` modules are private."""

from shop.orders.services._totals import order_total

__all__ = ["order_total"]
