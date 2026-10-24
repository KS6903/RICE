"""The Boss closing the mill's account, or opening it again (services/account_service.py).

Mounted under /api/auth with no data-router gates, so the Boss of a closed
account can still reach it.
"""

from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.cookies import clear_auth_cookies
from ..core.database import get_db
from ..core.security import get_current_user, require_roles
from ..services.account_service import AccountService

router = APIRouter(dependencies=[Depends(require_roles("owner"))])


class AccountCloseIn(BaseModel):
    mode: Literal["pause", "delete"]
    current_password: str | None = None
    mfa_code: str | None = None
    # Asking for deletion: the mill's name, typed to confirm.
    confirm_name: str | None = None


def get_account_service(db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> AccountService:
    return AccountService(db, current_user)


@router.get("/closure")
def closure(svc: AccountService = Depends(get_account_service)):
    """The account's state, and what (if anything) stops it closing now."""
    return svc.closure()


@router.post("/close")
def close(body: AccountCloseIn, response: Response, svc: AccountService = Depends(get_account_service)):
    """Pause the account, or ask for it to be deleted. Signs everyone out."""
    result = svc.close(body)
    clear_auth_cookies(response)
    return result


@router.post("/reopen")
def reopen(svc: AccountService = Depends(get_account_service)):
    """Switch a paused account back on, or take back a deletion request."""
    return svc.reopen()
