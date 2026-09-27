import os
from pathlib import Path
from urllib.parse import urlparse

import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
url = os.environ["DATABASE_URL"]
parsed = urlparse(url)
db = parsed.path.lstrip("/")
test_db = f"{db} Test"
print(f"Dropping test DB: {test_db!r}")

conn = psycopg.connect(
    host=parsed.hostname, port=parsed.port or 5432,
    user=parsed.username, password=parsed.password,
    dbname="postgres", autocommit=True,
)
conn.execute(f'DROP DATABASE IF EXISTS "{test_db}"')
conn.close()
print("Done — conftest will recreate it on next pytest run")
