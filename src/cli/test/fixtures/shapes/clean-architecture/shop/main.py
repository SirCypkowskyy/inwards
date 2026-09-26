from shop.application.use_cases.place_order import place_order
from shop.infrastructure.di import repository

place_order(repository)
