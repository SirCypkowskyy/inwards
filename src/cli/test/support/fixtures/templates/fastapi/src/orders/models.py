from sqlalchemy.orm import Mapped, mapped_column

from src.models import Base


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
