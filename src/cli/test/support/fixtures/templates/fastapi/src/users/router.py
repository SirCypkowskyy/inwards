from fastapi import APIRouter, Depends

from src.users.dependencies import valid_user_id
from src.users.schemas import UserOut

router = APIRouter(prefix="/users")


@router.get("/{user_id}")
async def get_user(user: UserOut = Depends(valid_user_id)) -> UserOut:
    return user
