"""Reproduce the /admin/stats error."""
import traceback
from datetime import datetime, timedelta, timezone
from sqlalchemy import func
from app.core.database import SessionLocal
from app.models.company import Company, Branch
from app.models.user import User
from app.models.paddy import PalayPurchase
from app.models.milling import MillingBatch
from app.models.sales import SalesOrder
from app.models.subscription import Subscription, SubscriptionPlan


def main():
    db = SessionLocal()
    try:
        print("total_tenants:", db.query(func.count(Company.id)).scalar())
        print("total_branches:", db.query(func.count(Branch.id)).scalar())
        print("total_users:", db.query(func.count(User.id)).filter(User.is_platform_admin == False).scalar())
        print("total_purchases:", db.query(func.count(PalayPurchase.id)).scalar())
        print("total_batches:", db.query(func.count(MillingBatch.id)).scalar())
        print("total_orders:", db.query(func.count(SalesOrder.id)).scalar())

        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        print("new_tenants_30d:", db.query(func.count(Company.id)).filter(Company.created_at >= thirty_days_ago).scalar())

        seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
        print("active_users_7d:", db.query(func.count(User.id)).filter(User.is_platform_admin == False, User.last_login >= seven_days_ago).scalar())

        now = datetime.now(timezone.utc)
        subs_join = db.query(Subscription).join(SubscriptionPlan).all()
        print("subs_join len:", len(subs_join))
        paid_company_ids = set()
        for s in subs_join:
            if s.status in ("active", "trial") and (s.expires_at is None or s.expires_at > now) and s.plan is not None and s.plan.code != "free":
                paid_company_ids.add(s.company_id)
        print("paid_company_ids:", paid_company_ids)

        subscribed_users = db.query(func.count(User.id)).filter(
            User.is_platform_admin == False,
            User.company_id.in_(paid_company_ids),
        ).scalar() or 0
        print("subscribed_users:", subscribed_users)

        unsubscribed_users = db.query(func.count(User.id)).filter(
            User.is_platform_admin == False,
            User.company_id.not_in(paid_company_ids) if paid_company_ids else True,
        ).scalar() or 0
        print("unsubscribed_users:", unsubscribed_users)
    except Exception as e:
        print(f"FAIL: {type(e).__name__}: {e}")
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    main()
