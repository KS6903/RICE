"""The language the web app shows to this account (packages/web/src/i18n)."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user

router = APIRouter()


class LanguageIn(BaseModel):
    # A language tag such as "en", "tl", "ceb" or "zh-CN"; null goes back to the
    # app's default. Which languages exist is up to the web app's language files.
    language: str | None = Field(default=None, max_length=16, pattern=r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")


@router.put("")
def set_language(body: LanguageIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Show the app in this language, on every device this account signs in on."""
    current_user.language = body.language
    db.commit()
    return {"language": current_user.language}
