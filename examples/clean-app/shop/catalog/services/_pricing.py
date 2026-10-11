"""How a discount changes a price."""

from shop.shared.models import Money


def discounted(price: Money, percent: int) -> Money:
    """The price after `percent` off, rounded down to a whole cent."""
    if not 0 <= percent <= 100:
        msg = f"a discount is 0 to 100 percent, not {percent}"
        raise ValueError(msg)
    return Money(price.cents * (100 - percent) // 100)
