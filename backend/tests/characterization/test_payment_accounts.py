"""BossAdmin's Settings > Payment accounts: each plan's bank account and QR code.

The QR pictures go to Cloudflare R2 when it is set up, else (here) a folder.
"""

import pytest

from app.core.config import settings
from app.models.subscription import SubscriptionPlan

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


@pytest.fixture
def pro(db_session):
    plan = SubscriptionPlan(code="pro_pay", name="Pro", features=["paddy"], is_active=True, monthly_price=1999)
    db_session.add(plan)
    db_session.flush()
    return plan


@pytest.fixture
def media_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "MEDIA_DIR", str(tmp_path))
    return tmp_path


def test_payment_account_is_saved_and_kept_by_the_plan_form(admin_client, pro):
    res = admin_client.put(
        f"/api/admin/plans/{pro.id}/payment-account",
        json={"payment_bank": "MariBank", "payment_account_name": "Oraiza", "payment_account_number": "1238 7690 477"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["payment_account_number"] == "1238 7690 477"

    # Editing the plan itself (no payment fields sent) leaves the account alone.
    upd = admin_client.put(f"/api/admin/plans/{pro.id}", json={"code": "pro_pay", "name": "Pro 2"})
    assert upd.status_code == 200, upd.text
    assert upd.json()["payment_bank"] == "MariBank"
    assert upd.json()["payment_account_number"] == "1238 7690 477"


def test_qr_upload_replace_and_remove(admin_client, client, pro, media_dir):
    first = admin_client.post(f"/api/admin/plans/{pro.id}/payment-qr", files={"file": ("qr.png", PNG, "image/png")})
    assert first.status_code == 200, first.text
    key = first.json()["payment_qr_key"]
    assert key.startswith(f"payment-qr/{pro.id}/") and key.endswith(".png")
    assert (media_dir / key).read_bytes() == PNG

    shown = client.get(f"/api/media/{key}")
    assert shown.status_code == 200
    assert shown.headers["content-type"] == "image/png"
    assert shown.content == PNG

    second = admin_client.post(f"/api/admin/plans/{pro.id}/payment-qr", files={"file": ("qr.jpg", JPEG, "image/jpeg")})
    new_key = second.json()["payment_qr_key"]
    assert new_key.endswith(".jpg") and new_key != key
    assert not (media_dir / key).exists()  # the old picture is gone

    removed = admin_client.delete(f"/api/admin/plans/{pro.id}/payment-qr")
    assert removed.json()["payment_qr_key"] is None
    assert not (media_dir / new_key).exists()
    assert client.get(f"/api/media/{new_key}").status_code == 404


def test_qr_must_be_a_picture(admin_client, pro, media_dir):
    for name, body in (("qr.svg", b"<svg onload=alert(1)></svg>"), ("qr.txt", b"hello")):
        res = admin_client.post(f"/api/admin/plans/{pro.id}/payment-qr", files={"file": (name, body, "image/png")})
        assert res.status_code == 400, name
    too_big = PNG + b"\x00" * (3 * 1024 * 1024)
    res = admin_client.post(f"/api/admin/plans/{pro.id}/payment-qr", files={"file": ("qr.png", too_big, "image/png")})
    assert res.status_code == 400


def test_a_deployed_site_without_r2_refuses_uploads(admin_client, pro, monkeypatch):
    monkeypatch.setattr(settings, "ENV", "preview")
    res = admin_client.post(f"/api/admin/plans/{pro.id}/payment-qr", files={"file": ("qr.png", PNG, "image/png")})
    assert res.status_code == 501
    assert "R2" in res.json()["detail"]


def test_media_serves_only_payment_pictures(client, media_dir):
    (media_dir / "secret.png").write_bytes(PNG)
    assert client.get("/api/media/secret.png").status_code == 404
    assert client.get("/api/media/payment-qr/../secret.png").status_code == 404


def test_payment_account_routes_are_platform_admin_only(make_auth_client, pro):
    owner = make_auth_client(features=[], username="notadmin")
    assert owner.put(f"/api/admin/plans/{pro.id}/payment-account", json={}).status_code == 403
    assert owner.post(f"/api/admin/plans/{pro.id}/payment-qr", files={"file": ("q.png", PNG)}).status_code == 403
