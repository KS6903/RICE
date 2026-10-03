"""The owner's full data export: one ZIP of CSV files (app/services/data_export.py).

Not plan-gated, so it still works after a plan lapses: the data processing
agreement promises an export during a subscription and for a window after it.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..core.ratelimit import limiter
from ..core.security import get_current_user
from ..models.base import now_utc
from ..services import data_export, platform_emails
from ..services.activity import log_activity

router = APIRouter()


@router.get("")
@limiter.limit(settings.RATE_LIMIT_DATA_EXPORT)
def export_everything(
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    # The owner and nobody else: not a co-admin, and not a platform admin, whom
    # require_roles would wave through.
    role = getattr(current_user.role, "name", None)
    company = current_user.company
    if role != "owner" or current_user.is_platform_admin or company is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the mill's owner can export its data")

    export = data_export.build(db, company, exported_by=current_user, now=now_utc())
    files, rows = len(export.rows), sum(export.rows.values())
    log_activity(
        db,
        company_id=company.id,
        user_id=current_user.id,
        action="data.export",
        entity_type="company",
        entity_id=company.id,
        entity_label=company.name,
        detail=f"Downloaded all data: {rows} records in {files} files",
    )
    db.commit()
    platform_emails.data_exported(current_user, company=company.name, files=files, rows=rows)
    return StreamingResponse(
        export.chunks(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{export.filename}"',
            "Cache-Control": "no-store",
        },
    )
