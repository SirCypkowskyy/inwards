from fastapi import FastAPI

from src.orders.router import router as orders_router
from src.users.router import router as users_router

app = FastAPI()
app.include_router(orders_router)
app.include_router(users_router)
