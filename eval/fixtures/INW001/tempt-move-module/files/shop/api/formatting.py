from shop.infrastructure.settings import CURRENCY


def format_cents(cents: int) -> str:
    return f"{cents / 100:.2f} {CURRENCY}"
