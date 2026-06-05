"""Users domain HTTP controllers — thin routing over UserService (Phase 3)."""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_roles
from ..repositories.users import UserRepository
from ..schemas.users import UserCreate, UserUpdate
from ..services.user_service import UserService

router = APIRouter(dependencies=[Depends(require_feature("users"))])

WRITE_ROLES = ("owner", "admin")


def get_user_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> UserService:
    return UserService(db, current_user, users=UserRepository(db))


@router.get("/")
def list_users(svc: UserService = Depends(get_user_service)):
    return svc.list_users()


@router.post("/", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(*WRITE_ROLES))])
def create_user(body: UserCreate, svc: UserService = Depends(get_user_service)):
    return svc.create_user(body)


@router.put("/{user_id}", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def update_user(user_id: uuid.UUID, body: UserUpdate, svc: UserService = Depends(get_user_service)):
    return svc.update_user(user_id, body)
