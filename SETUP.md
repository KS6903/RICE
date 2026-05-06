# Rice Mill System — Setup Guide

## Prerequisites
- Node.js 20+
- Python 3.11+ (3.14 tested)
- PostgreSQL 15 with pgAdmin 4
- A database named `RiceMillSystem` already created in pgAdmin 4

---

## Step 1: Database Setup in pgAdmin 4

1. Open pgAdmin 4
2. Right-click on your server → **Create Database**
3. Name it exactly: `RiceMillSystem`
4. Note your PostgreSQL username and password (usually `postgres`)

---

## Step 2: Backend Setup

```bash
cd backend

# 1. Create virtual environment
python -m venv .venv

# 2. Activate it
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
copy .env.example .env
# Edit .env — update DATABASE_URL with your pgAdmin password:
# DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/RiceMillSystem

# 5. Run database migrations (creates all tables in pgAdmin)
alembic upgrade head

# 6. Seed initial reference data (rice varieties, grades, roles)
python seed.py

# 7. Start the API server
python run.py
# → API running at http://localhost:8000
# → Docs at http://localhost:8000/api/docs
```

---

## Step 3: Frontend Web App

```bash
# From the project root:
npm install

# Start the web app (development)
npm run dev:web
# → Opens at http://localhost:5173
```

---

## Step 4: Desktop App (Electron)

```bash
# From the project root (requires web app running first):
npm run dev:desktop
# → Opens the Electron window loading localhost:5173
# → Works offline using local SQLite database
# → Auto-syncs to PostgreSQL when internet is available
```

---

## First Login — Create Admin User

After running migrations and seed, create your first admin user:

```bash
# In the backend directory with venv active:
python -c "
from app.core.database import SessionLocal
from app.models.user import User
from app.models.company import Company, Branch
from app.core.security import hash_password
import uuid

db = SessionLocal()

# Create company
company = Company(name='Your Rice Mill Name', currency='PHP', timezone='Asia/Manila')
db.add(company)
db.flush()

# Create branch
branch = Branch(company_id=company.id, name='Main Branch', is_main_branch=True)
db.add(branch)
db.flush()

# Create admin user
admin = User(
    company_id=company.id,
    branch_id=branch.id,
    username='admin',
    full_name='Administrator',
    password_hash=hash_password('admin123'),
    role_id=1,
)
db.add(admin)
db.commit()
print('Admin user created: username=admin, password=admin123')
"
```

Then log in at http://localhost:5173 with `admin` / `admin123`.

---

## Verification Checklist

- [ ] pgAdmin shows all tables after `alembic upgrade head`
- [ ] `GET http://localhost:8000/api/health` returns `{"status": "ok"}`
- [ ] Login page loads at http://localhost:5173
- [ ] Login works → redirected to Dashboard
- [ ] Palay page → can create a supplier and record a purchase
- [ ] Milling page → can create a milling batch
- [ ] Inventory page → shows stock after purchase and milling
- [ ] Reports → P&L shows after data entry

---

## Offline Sync (Desktop App)

The Electron desktop app:
- Uses a local SQLite database (`%APPDATA%/Rice Mill System/rice-mill-local.db`)
- All data entry works offline — records tagged with `_synced = 0`
- When internet is detected, automatically pushes unsynced records to the cloud PostgreSQL
- Pulls remote changes made by other users/branches
- Conflict resolution shown in the UI if same record was edited in both places
