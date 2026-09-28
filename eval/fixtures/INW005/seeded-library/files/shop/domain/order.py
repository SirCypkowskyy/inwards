import subprocess
from dataclasses import dataclass

from shop.domain.ports import OrderRepository


@dataclass
class Order:
    id: str
    total_cents: int


def place(order: Order, repo: OrderRepository) -> None:
    repo.save(order)


def build_label() -> str:
    done = subprocess.run(["git", "describe", "--always"], capture_output=True, text=True)
    return done.stdout.strip()
