"""Legal document + acceptance controller.

The document endpoints are deliberately unauthenticated: someone deciding
whether to sign up has to be able to read the terms first, and a term nobody
could read before agreeing is a weak term.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..core import legal as legal_docs
from ..core.database import get_db
from ..core.security import get_current_user
from ..services.legal_service import LegalService

router = APIRouter()


def get_legal_service(db: Session = Depends(get_db)) -> LegalService:
    return LegalService(db)


# ── Public ────────────────────────────────────────────────────────────────


@router.get("/documents")
def list_documents():
    return LegalService().index()


@router.get("/documents/{key}")
def get_document(key: str):
    if key not in legal_docs.BY_KEY:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown legal document.")
    return LegalService().document(key)


# ── Authenticated ─────────────────────────────────────────────────────────


@router.get("/acceptance")
def acceptance_status(
    current_user=Depends(get_current_user),
    svc: LegalService = Depends(get_legal_service),
):
    return svc.status(current_user.id)


@router.post("/acceptance", status_code=status.HTTP_201_CREATED)
def accept(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    svc: LegalService = Depends(get_legal_service),
):
    """Record acceptance of the current agreement bundle.

    Idempotent for the current version: re-posting after accepting returns the
    existing state instead of stacking duplicate rows for one click.
    """
    if not svc.acceptance_required(current_user.id):
        return svc.status(current_user.id)
    svc.record_acceptance(
        user_id=current_user.id,
        company_id=current_user.company_id,
        request=request,
        method="gate",
    )
    db.commit()
    return svc.status(current_user.id)


@router.get("/acceptance/history")
def acceptance_history(
    current_user=Depends(get_current_user),
    svc: LegalService = Depends(get_legal_service),
):
    """The user's own acceptance trail, so they can see what they agreed to."""
    return svc.history(current_user.id)
