# Build context is the REPOSITORY ROOT, not backend/ (see wrangler.jsonc
# image_build_context and the root .dockerignore), so that legal/ can be
# copied in alongside backend/.
#
# Shared image for both Cloudflare Container classes: the API (PROCESS_ROLE=api)
# and the tenant-DDL provisioner (PROCESS_ROLE=provisioner). They run as separate
# containers because app/core/config.py refuses to boot the API when the
# provisioner credential is in scope — the entrypoint is overridden per class.
# Pinned by digest like the GitHub Actions, so every build starts from the same
# bytes. Dependabot's docker entry proposes 3.11.x patch and digest refreshes.
FROM python:3.11.17-slim@sha256:e88e9763f943ec1834f992a4b51e0f24500486803e8bc534e5767af9ea65f6ce

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# psycopg[binary], bcrypt and cryptography all ship manylinux wheels, so no
# compiler toolchain is needed. --require-hashes keeps the supply chain pinned.
COPY backend/requirements.txt ./
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.txt

COPY backend/app ./app
COPY backend/migrations ./migrations
COPY backend/alembic.ini ./
COPY backend/provision_pending_tenants.py backend/migrate_all_tenants.py ./

# Published legal agreements. They live at the repository root because they are
# product documents reviewed by counsel, not backend code, so the build context
# is the repo root (wrangler.jsonc -> image_build_context) and .dockerignore
# keeps the rest of the tree out. The API serves them and, under ENV=prod,
# refuses to boot if they are missing or still hold placeholders.
COPY legal ./legal
ENV LEGAL_DOCS_DIR=/app/legal

RUN useradd --system --uid 10001 --no-create-home oryza \
    && chown -R oryza:oryza /app
USER oryza

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
