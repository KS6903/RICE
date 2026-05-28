"""Reproduce the tenants endpoint error in isolation."""
import traceback
from app.core.database import SessionLocal
from app.models.company import Company, Branch
from app.models.user import User
from app.models.paddy import PalayPurchase
from app.models.sales import SalesOrder
from app.models.subscription import Subscription
from app.services.subscription import effective_status
from sqlalchemy import func


def main():
    db = SessionLocal()
    try:
        companies = db.query(Company).order_by(Company.created_at.desc()).all()
        print(f"companies: {len(companies)}")
        user_counts = dict(db.query(User.company_id, func.count(User.id)).group_by(User.company_id).all())
        branch_counts = dict(db.query(Branch.company_id, func.count(Branch.id)).group_by(Branch.company_id).all())
        purchase_counts = dict(db.query(PalayPurchase.company_id, func.count(PalayPurchase.id)).group_by(PalayPurchase.company_id).all())
        order_counts = dict(db.query(SalesOrder.company_id, func.count(SalesOrder.id)).group_by(SalesOrder.company_id).all())
        subs = db.query(Subscription).all()
        sub_by_company = {s.company_id: s for s in subs}
        print(f"subs: {len(subs)}")

        for i, c in enumerate(companies):
            try:
                s = sub_by_company.get(c.id)
                sub_block = {}
                if s:
                    print(f"  [{i}] company {c.name} -> sub id={s.id}, plan={s.plan}")
                    if s.plan:
                        sub_block = {
                            "plan_code": s.plan.code,
                            "plan_name": s.plan.name,
                            "subscription_status": effective_status(s) or s.status,
                        }
                d = {
                    "id": str(c.id),
                    "name": c.name,
                    "users_count": user_counts.get(c.id, 0),
                    **sub_block,
                }
                print(f"  OK [{i}] {c.name}")
            except Exception as e:
                print(f"  FAIL [{i}] {c.name}: {type(e).__name__}: {e}")
                traceback.print_exc()
                return
    finally:
        db.close()


if __name__ == "__main__":
    main()
