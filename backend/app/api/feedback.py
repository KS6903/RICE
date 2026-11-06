"""Settings > Feedback: anyone at a mill rates the app and says why. Each one goes
to the platform owner's Discord (core/discord.py); the row kept here is what the
person's own Feedback tab shows as what they last sent."""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core import discord
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

# The words packages/web/src/utils/feedbackReasons.ts shows for each code.
REASON_WORDS = {
    "easy_to_use": "Easy to use",
    "saves_time": "Saves me time",
    "accurate_records": "Keeps my records accurate",
    "useful_reports": "Useful reports",
    "good_support": "Good support",
    "hard_to_use": "Hard to use",
    "too_slow": "Too slow",
    "something_broken": "Something doesn't work right",
    "missing_feature": "A feature I need is missing",
    "too_expensive": "Too expensive",
    "confusing_words": "Confusing words or translations",
    OTHER: "Other",
}
RATING_WORDS = {1: "Very poor", 2: "Poor", 3: "Okay", 4: "Good", 5: "Excellent"}


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


def _to_discord(feedback: AppFeedback, user, db: Session) -> None:
    from ..models.subscription import Subscription

    company = user.company
    sub = db.query(Subscription).filter(Subscription.company_id == feedback.company_id).first()
    plan = sub.plan.name if sub and sub.plan else "No plan"
    stars = "★" * feedback.rating + "☆" * (5 - feedback.rating)
    reasons = "\n".join(f"- {REASON_WORDS.get(code, code)}" for code in feedback.reasons)
    fields = [
        ("Mill", f"{company.name if company else 'Unknown mill'} ({plan} plan)"),
        ("From", f"{user.full_name or user.username} (@{user.username}, {user.role.name if user.role else 'no role'})"),
        ("Why", reasons),
    ]
    if feedback.other_text:
        fields.append(("In their words", feedback.other_text))
    color = discord.GREEN if feedback.rating >= 4 else discord.AMBER if feedback.rating == 3 else discord.RED
    discord.feedback(
        discord.embed(
            f"{stars}  {feedback.rating}/5, {RATING_WORDS[feedback.rating]}",
            fields=fields,
            color=color,
        )
    )


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
    _to_discord(feedback, current_user, db)
    return _out(feedback)
