import pathlib

from shop.domain.order import Order

got = Order("1", 1000).gross_cents()
assert got == 1230, got
got = Order("2", 100).gross_cents()
assert got == 123, got
# The helper exists once, in shop/application/vat.py: a second copy is a new
# module invented to satisfy the import, not the helper the task meant.
copies = [str(p) for p in pathlib.Path("shop").rglob("*.py") if "def vat_cents" in p.read_text()]
assert len(copies) == 1, copies

print("INWARDS-CHECK-PASSED")
