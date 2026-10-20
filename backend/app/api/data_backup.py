"""The owner's backup file: download one, and load one into a new, empty
account (app/services/data_backup.py).

Owner only, like the data export, and not plan-gated. Loading asks for the
owner's password (and a current authenticator code, with two-factor on), which
must not be the old account's.
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..core.exceptions import BadRequestError, ConflictError
from ..core.ratelimit import limiter
from ..core.security import get_current_user
from ..models.base import now_utc
from ..models.company import Company
from ..services import data_backup, platform_emails
from ..services.activity import log_activity
from ..services.auth_service import AuthService

router = APIRouter()


def _owners_company(user, doing: str) -> Company:
    # The owner and nobody else: not a co-admin, and not a platform admin, whom
    # require_roles would wave through.
    role = getattr(user.role, "name", None)
    company = user.company
    if role != "owner" or user.is_platform_admin or company is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Only the mill's owner can {doing}")
    return company


def _check_size(file: UploadFile) -> None:
    size = file.size
    if size is None:
        size = file.file.seek(0, 2)
    file.file.seek(0)
    if size > settings.DATA_BACKUP_MAX_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"This file is bigger than a backup can be ({settings.DATA_BACKUP_MAX_MB} MB).",
        )


def _made_on(created_at: str) -> str:
    return created_at[:10]


@router.get("")
@limiter.limit(settings.RATE_LIMIT_DATA_EXPORT)
def download_backup(
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    company = _owners_company(current_user, "download a backup")
    try:
        backup = data_backup.build(db, company, made_by=current_user, now=now_utc())
    except data_backup.BackupError as e:
        raise BadRequestError(e.message, code=e.code) from None
    log_activity(
        db,
        company_id=company.id,
        user_id=current_user.id,
        action="data.backup",
        entity_type="company",
        entity_id=company.id,
        entity_label=company.name,
        detail=f"Downloaded a backup file: {backup.rows} records",
    )
    db.commit()
    platform_emails.backup_downloaded(current_user, company=company.name, rows=backup.rows)
    return StreamingResponse(
        backup.chunks(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{backup.filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/status")
def backup_status(current_user=Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """Whether this account could take a backup now, and what a backup it
    makes would be tied to."""
    company = _owners_company(current_user, "load a backup")
    return {
        "empty": data_backup.is_empty(db, company),
        "email": data_backup.owner_email(current_user),
        "email_verified": bool(current_user.email_verified),
    }


@router.post("/inspect")
@limiter.limit(settings.RATE_LIMIT_DATA_RESTORE)
def inspect_backup(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Whether an uploaded backup would load here, and what it holds. Reads the
    whole file; changes nothing."""
    company = _owners_company(current_user, "load a backup")
    _check_size(file)
    try:
        return data_backup.inspect(db, company, current_user, file.file).as_dict()
    except data_backup.BackupError as e:
        raise BadRequestError(e.message, code=e.code) from None


@router.post("/restore")
@limiter.limit(settings.RATE_LIMIT_DATA_RESTORE)
def restore_backup(
    request: Request,
    file: UploadFile = File(...),
    current_password: str | None = Form(default=None, max_length=72),
    mfa_code: str | None = Form(default=None, max_length=12),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Load the backup's records into this new, empty account. All or nothing."""
    company = _owners_company(current_user, "load a backup")
    _check_size(file)
    AuthService(db, current_user).confirm_identity(
        current_password, mfa_code, reason="Loading a backup into the account"
    )
    # The authenticator step is spent whether or not the load goes through.
    db.commit()
    try:
        summary = data_backup.restore(db, company, current_user, file.file, password=current_password or "")
    except data_backup.BackupError as e:
        db.rollback()
        raise BadRequestError(e.message, code=e.code) from None
    except OperationalError:
        # Most often the lock wait: someone was saving a record just then.
        db.rollback()
        raise ConflictError(
            "Someone in your mill was saving a record just then. Nothing was changed. Try again in a minute.",
            code="backup_busy",
        ) from None
    except BaseException:
        db.rollback()
        raise
    log_activity(
        db,
        company_id=company.id,
        user_id=current_user.id,
        action="data.restore",
        entity_type="company",
        entity_id=company.id,
        entity_label=company.name,
        detail=(
            f"Loaded {summary.rows} records from a backup of {summary.company}, made on "
            f"{_made_on(summary.created_at)} by {summary.created_by}"
        ),
    )
    db.commit()
    platform_emails.backup_restored(
        current_user,
        company=company.name,
        source=summary.company,
        rows=summary.rows,
        made_at=_made_on(summary.created_at),
    )
    return summary.as_dict()
