"""Unit tests for the AppException hierarchy + global handler (Phase 1.1)."""
import json

import pytest

from app.core.exceptions import (
    AppException,
    ConflictError,
    FeatureRequiredError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
    app_exception_handler,
)


def test_subclass_status_and_code_mapping():
    assert NotFoundError("x").status_code == 404
    assert NotFoundError("x").code == "not_found"
    assert ConflictError("x").status_code == 409
    assert PermissionDeniedError("x").status_code == 403
    assert ValidationError("x").status_code == 422
    assert FeatureRequiredError("x").status_code == 402


def test_message_and_custom_code():
    exc = ConflictError("dup code", code="variety_exists")
    assert exc.message == "dup code"
    assert str(exc) == "dup code"
    assert exc.code == "variety_exists"


def test_base_defaults_to_500():
    assert AppException("boom").status_code == 500
    assert AppException("boom").code == "internal_error"


@pytest.mark.asyncio
async def test_handler_renders_detail_and_code():
    res = await app_exception_handler(None, NotFoundError("Variety not found"))
    assert res.status_code == 404
    body = json.loads(bytes(res.body))
    # `detail` MUST stay (frontend interceptor depends on it); `code` is additive.
    assert body == {"detail": "Variety not found", "code": "not_found"}
