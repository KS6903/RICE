# Shared image for both Cloudflare Container classes: the API (PROCESS_ROLE=api)
# and the tenant-DDL provisioner (PROCESS_ROLE=provisioner). They run as separate
# containers because app/core/config.py refuses to boot the API when the
# provisioner credential is in scope — the entrypoint is overridden per class.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# psycopg[binary], bcrypt and cryptography all ship manylinux wheels, so no
# compiler toolchain is needed. --require-hashes keeps the supply chain pinned.
COPY requirements.lock ./
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.lock

COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
COPY provision_pending_tenants.py migrate_all_tenants.py ./

RUN useradd --system --uid 10001 --no-create-home oryza \
    && chown -R oryza:oryza /app
USER oryza

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
