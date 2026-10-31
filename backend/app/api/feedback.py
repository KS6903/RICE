"""Settings > Feedback: anyone at a mill rates the app and says why. BossAdmin reads
them all (api/admin.py)."""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.ratelimit import limiter
from ..core.security import get_current_user
from ..models.feedback import AppFeedback

router = APIRouter()

# Why a rating was given; packages/web/src/utils/feedbackReasons.ts words them.
GOOD_REASONS = frozenset({"easy_to_use", "saves_time", "accurate_records", "useful_reports", "good_support"})
BAD_REASONS = frozenset(
    {"hard_to_use", "too_slow", "something_broken", "missing_feature", "too_expensive", "confusing_words"}
)
OTHER = "other"


class FeedbackIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    reasons: list[str] = Field(min_length=1, max_length=12)
    other_text: str | None = Field(None, max_length=500)


def _out(feedback: AppFeedback) -> dict:
    return {
        "id": str(feedback.id),
        "rating": feedback.rating,
        "reasons": feedback.reasons,
        "other_text": feedback.other_text,
        "created_at": feedback.created_at.isoformat(),
    }


def _company_id(user):
    if not user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Feedback is for accounts at a mill.")
    return user.company_id


@router.get("")
def my_latest(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """What this person last sent, or nothing yet."""
    latest = (
        db.query(AppFeedback)
        .filter(AppFeedback.company_id == _company_id(current_user), AppFeedback.user_id == current_user.id)
        .order_by(AppFeedback.created_at.desc())
        .first()
    )
    return _out(latest) if latest else None


@router.post("", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/hour")
def send(
    request: Request,
    body: FeedbackIn,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = (GOOD_REASONS if body.rating >= 4 else BAD_REASONS) | {OTHER}
    reasons = list(dict.fromkeys(body.reasons))
    if not set(reasons) <= allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pick a reason from the list.")
    other_text = (body.other_text or "").strip() if OTHER in reasons else ""
    if OTHER in reasons and not other_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Say what your other reason is.")
    feedback = AppFeedback(
        company_id=_company_id(current_user),
        user_id=current_user.id,
        rating=body.rating,
        reasons=reasons,
        other_text=other_text or None,
    )
    db.add(feedback)
    db.commit()
    return _out(feedback)
