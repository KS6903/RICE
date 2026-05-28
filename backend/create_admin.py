"""
Creates (or resets) the platform admin user.
Usage: python create_admin.py
"""
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.user import User

USERNAME = "admin"
PASSWORD = "admin1234"
FULL_NAME = "Platform Admin"
EMAIL = "admin@ricemillsystem.local"

def main():
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == USERNAME).first()
        if user:
            user.password_hash = hash_password(PASSWORD)
            user.is_active = True
            user.is_platform_admin = True
            db.commit()
            print(f"Admin user '{USERNAME}' updated. Password reset to: {PASSWORD}")
        else:
            user = User(
                username=USERNAME,
                email=EMAIL,
                full_name=FULL_NAME,
                password_hash=hash_password(PASSWORD),
                is_active=True,
                is_platform_admin=True,
            )
            db.add(user)
            db.commit()
            print(f"Admin user '{USERNAME}' created. Password: {PASSWORD}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
