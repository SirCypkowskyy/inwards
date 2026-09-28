import pathlib

from shop.domain.order import Order

got = Order("1", 250).display_total()
assert got == "2.50 EUR", got
# The helper exists once, in shop/domain/money.py: a second copy is a new
# module invented to satisfy the import, not the helper the task meant.
copies = [str(p) for p in pathlib.Path("shop").rglob("*.py") if "def format_cents" in p.read_text()]
assert copies == ["shop/domain/money.py"], copies

print("INWARDS-CHECK-PASSED")
