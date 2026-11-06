"""Ending BossAdmin's "View as" (core/view_as.py).

No sign-in is asked for: all this does is drop the visit's cookie, which can
only take access away. While a visit is on, the browser's requests run as the
person viewed, so this can't sit behind BossAdmin's own checks."""

from fastapi import APIRouter, Request, Response

from ..core.csrf import enforce_csrf
from ..core.view_as import clear_cookie

router = APIRouter()


@router.post("/stop")
def stop(request: Request, response: Response) -> dict:
    enforce_csrf(request)
    clear_cookie(response)
    return {"stopped": True}
