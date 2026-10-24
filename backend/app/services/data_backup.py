"""A mill's backup file, and loading it into a new account.

The owner downloads one binary file (``.oraiza``) holding every record in the
mill's own schema. Later, from a brand-new account (Settings → Your data while
the account is empty, or /retrieve-data), they upload it to bring those records
back. Unlike the data export (services/data_export.py), which is for people to
read, this file is for us alone.

Who may load a backup, and where (``check_owner``, ``is_empty`` and the rest):
- only into an account with no records of its own yet, so loading never
  overwrites anyone's work;
- only by that account's owner, whose verified email is the one the backup was
  made under. The file's key is derived from that email, so for anyone else
  the file doesn't even open;
- only under a new username and password, not the old account's;
- only when the account's plan has room for the backup's branches.

How nobody else is ever touched:

1. Nobody but us can read the file or change it. It is compressed, then sealed
   with AES-256-GCM under a key derived from our root key, the file's own salt
   and the owner's email (core/crypto.derive_key). Changing, dropping,
   reordering or appending a single byte fails the authentication tag.

2. A load writes only to the uploader's account: its own schema, named in every
   statement, and the branches it creates for itself. Nothing else in
   ``public`` is written, and the activity log is never replaced (KEPT_TABLES).
   Table and column names come from our models, never from the file; every
   value is decoded by its column's type. The old mill's id becomes the new
   one's, and any other mill's id refuses the file. A reference to the old
   mill's people or branches moves to the new account's (the old owner becomes
   the new owner) or is dropped. The whole load is one transaction, so a file
   that fails any of this changes nothing.

File layout, format 1:

    magic      8 bytes   b"\\x89ORAIZA\\n"
    format     1 byte    1
    key        1 byte    1: derived from the root key and the owner's email
    salt      32 bytes   random, per file
    segments   ...       64 KiB of plaintext each, sealed, plus a 16-byte tag

Segments follow the STREAM construction: segment i is sealed with nonce
i (11 bytes, big-endian) + a last-segment flag (1 byte), and each one
authenticates the header. The plaintext is zlib-compressed JSON lines:

    {"manifest": {...}}
    {"table": "<name>", "columns": [...]}   then one JSON array per row
    ...
    {"end": {"rows": <n>}}

Tables come parents first, so a load can insert them in file order.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import tempfile
import uuid
import zlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import IO, Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Table,
    Uuid,
    bindparam,
    func,
    literal,
    select,
    text,
)
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.sql.util import sort_tables

from ..core import health
from ..core.crypto import derive_key
from ..core.security import get_user_features, verify_password
from ..core.tenancy import PUBLIC_TABLE_NAMES, seed_default_expense_categories, tenant_tables, valid_schema_name
from ..models.company import Branch, Company
from ..models.subscription import Subscription
from ..models.user import Role, User
from .data_export import _slug

MAGIC = b"\x89ORAIZA\n"
FORMAT = 1
KEY_ROOT = 1
SALT_BYTES = 32
SEGMENT = 64 * 1024
TAG = 16
HEADER_BYTES = len(MAGIC) + 2 + SALT_BYTES
EXTENSION = ".oraiza"
_PURPOSE = b"oraiza/data-backup/1/"

# Spooled: an ordinary mill's backup stays in memory; a large one goes to disk.
_IN_MEMORY_BYTES = 32 * 1024 * 1024
_BATCH = 1000
# A file can't unpack to more than this, nor hold a longer line (a row with a
# stored report file is the longest). Both are far past any real mill's.
_MAX_INFLATED = 1024 * 1024 * 1024
_MAX_LINE = 64 * 1024 * 1024

NOT_A_BACKUP = "This isn't a backup file. Choose the .oraiza file you downloaded under Backup and restore."
NOT_YOURS = (
    "This backup can't be opened by this account. It opens only for a new account made with the same "
    "email address as the account it came from, and only exactly as it was downloaded."
)
DAMAGED = "This backup file is damaged. Download a new backup and try again."
TOO_BIG = "This backup holds more than can be loaded at once. Contact support."
TOO_NEW = "This backup was made by a newer version of the app. Try again after the next update."
TOO_OLD = "This backup is too old to load with this version of the app."
DOESNT_FIT = "Some records in this backup don't fit this account. Nothing was changed."
NO_EMAIL = (
    "Add an email address to your account before downloading a backup: the backup opens only for that "
    "address. You can add it under Settings → My Profile."
)
UNVERIFIED = "Confirm your email address first. A backup only loads into an account whose email is confirmed."
NOT_EMPTY = (
    "This account already has records of its own. A backup loads only into a new account that has nothing in it yet."
)
SAME_USERNAME = (
    "For your security, a backup loads only into an account with a new username, not the one the backup "
    "came from. Create a new account with a new username and password."
)
SAME_PASSWORD = (
    "For your security, choose a new password, not the one your old account used. Change it under "
    "Settings → Password, then try again."
)


class BackupError(Exception):
    """The file can't be used, or not here. ``message`` is safe to show the owner."""

    def __init__(self, message: str, code: str = "backup_invalid") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass
class Backup:
    file: IO[bytes]
    filename: str
    rows: int

    def chunks(self, size: int = 64 * 1024) -> Iterator[bytes]:
        """The file's bytes, closing it at the end."""
        try:
            self.file.seek(0)
            while chunk := self.file.read(size):
                yield chunk
        finally:
            self.file.close()


@dataclass
class Summary:
    """What a backup holds, from its manifest and a full read."""

    company: str
    created_at: str
    created_by: str
    rows: int
    tables: int
    branches: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "company": self.company,
            "created_at": self.created_at,
            "created_by": self.created_by,
            "rows": self.rows,
            "tables": self.tables,
            "branches": self.branches,
        }


# Left out of a backup and left alone by a load. The activity log is the mill's
# record of what happened, the load included: an old copy has no place in it.
KEPT_TABLES = frozenset({"activity_logs"})

# Rows the app writes on its own, not anyone's work: an account with rows here
# is still empty. A load replaces them like everything else.
BOOKKEEPING_TABLES = frozenset(
    {
        "automation_rules",
        "automation_settings",
        "automation_state",
        "notification_attachments",
        "notifications",
        "sync_conflicts",
        "sync_log",
    }
)

# JSON lists of user ids, moved to the new account's people like a column is.
_USER_ID_LISTS = frozenset({("automation_rules", "recipients")})


def backup_tables() -> list[Table]:
    """The mill's own tables, parents before the tables that refer to them."""
    tables = [t for t in tenant_tables() if t.name not in KEPT_TABLES]
    return sort_tables(sorted(tables, key=lambda t: t.name))


def owner_email(user: User) -> str | None:
    return (user.email or "").strip().lower() or None


def _require_scope(db: Session, company: Company) -> str:
    """The mill's schema name, once the session is known to be on it."""
    schema = company.schema_name
    if not valid_schema_name(schema):
        raise RuntimeError("the company has no valid schema")
    current = db.execute(text("SELECT current_schema()")).scalar()
    if current != schema:
        # Fail closed: never read or write whatever schema a session happens to be on.
        raise RuntimeError("the session isn't scoped to this company's schema")
    return schema


def _in_schema(schema: str) -> dict[str, Any]:
    """Execution options naming the mill's schema in every statement."""
    return {"schema_translate_map": {None: schema}}


# ── the sealed file ───────────────────────────────────────────────────────────


def _aead(email: str, salt: bytes) -> AESGCM:
    tied_to = hashlib.sha256(email.encode("utf-8")).digest()
    return AESGCM(derive_key(purpose=_PURPOSE + tied_to, salt=salt))


def _nonce(index: int, last: bool) -> bytes:
    return index.to_bytes(11, "big") + (b"\x01" if last else b"\x00")


class _SealedWriter:
    """Compress, then seal, segment by segment. The last segment is held back
    until ``close`` so it can carry the last-segment flag."""

    def __init__(self, out: IO[bytes], email: str) -> None:
        salt = os.urandom(SALT_BYTES)
        self._header = MAGIC + bytes([FORMAT, KEY_ROOT]) + salt
        self._aead = _aead(email, salt)
        self._out = out
        self._deflate = zlib.compressobj(6)
        self._pending = bytearray()
        self._index = 0
        out.write(self._header)

    def write(self, data: bytes) -> None:
        self._pending += self._deflate.compress(data)
        self._drain()

    def close(self) -> None:
        self._pending += self._deflate.flush()
        self._drain()
        self._seal(bytes(self._pending), last=True)
        self._pending.clear()

    def _drain(self) -> None:
        # Strictly more than a segment: something (perhaps nothing) is always
        # left for the last one.
        while len(self._pending) > SEGMENT:
            self._seal(bytes(self._pending[:SEGMENT]), last=False)
            del self._pending[:SEGMENT]

    def _seal(self, chunk: bytes, *, last: bool) -> None:
        self._out.write(self._aead.encrypt(_nonce(self._index, last), chunk, self._header))
        self._index += 1


def _read(file: IO[bytes], size: int) -> bytes:
    parts, wanted = [], size
    while wanted:
        chunk = file.read(wanted)
        if not chunk:
            break
        parts.append(chunk)
        wanted -= len(chunk)
    return b"".join(parts)


def _opened(file: IO[bytes], email: str) -> Iterator[bytes]:
    """The plaintext segments, each checked before it is handed on."""
    header = _read(file, HEADER_BYTES)
    if len(header) < HEADER_BYTES or not header.startswith(MAGIC):
        raise BackupError(NOT_A_BACKUP, "backup_not_a_backup")
    if header[len(MAGIC)] != FORMAT or header[len(MAGIC) + 1] != KEY_ROOT:
        raise BackupError(TOO_NEW, "backup_too_new")
    aead = _aead(email, header[-SALT_BYTES:])
    index = 0
    sealed = _read(file, SEGMENT + TAG)
    while True:
        following = _read(file, SEGMENT + TAG)
        last = not following
        try:
            yield aead.decrypt(_nonce(index, last), sealed, header)
        except InvalidTag:
            raise BackupError(NOT_YOURS, "backup_not_yours") from None
        if last:
            return
        sealed, index = following, index + 1


def _inflated(chunks: Iterator[bytes]) -> Iterator[bytes]:
    inflate = zlib.decompressobj()
    total = 0
    try:
        for chunk in chunks:
            data = chunk
            while data:
                out = inflate.decompress(data, SEGMENT)
                total += len(out)
                if total > _MAX_INFLATED:
                    raise BackupError(TOO_BIG, "backup_too_big")
                if out:
                    yield out
                data = inflate.unconsumed_tail
        rest = inflate.flush()
    except zlib.error:
        raise BackupError(DAMAGED) from None
    if rest or not inflate.eof or inflate.unused_data:
        raise BackupError(DAMAGED)


def _lines(chunks: Iterator[bytes]) -> Iterator[bytes]:
    buffer = bytearray()
    for chunk in chunks:
        buffer += chunk
        start = 0
        while (end := buffer.find(b"\n", start)) >= 0:
            yield bytes(buffer[start:end])
            start = end + 1
        del buffer[:start]
        if len(buffer) > _MAX_LINE:
            raise BackupError(TOO_BIG, "backup_too_big")
    if buffer:
        raise BackupError(DAMAGED)


def _events(file: IO[bytes], email: str) -> Iterator[tuple]:
    """("manifest", dict), then ("table", name, columns) and ("row", values)
    in file order, then ("end", rows). Raises BackupError on anything else."""
    records = _lines(_inflated(_opened(file, email)))
    started = ended = False
    for line in records:
        try:
            record = json.loads(line)
        except (ValueError, RecursionError):
            raise BackupError(DAMAGED) from None
        if not started:
            if not (isinstance(record, dict) and set(record) == {"manifest"}):
                raise BackupError(DAMAGED)
            yield ("manifest", _manifest(record["manifest"], email))
            started = True
        elif ended:
            raise BackupError(DAMAGED)
        elif isinstance(record, list):
            yield ("row", record)
        elif isinstance(record, dict) and set(record) == {"table", "columns"}:
            name, columns = record["table"], record["columns"]
            if (
                not isinstance(name, str)
                or not isinstance(columns, list)
                or not all(isinstance(c, str) for c in columns)
                or len(set(columns)) != len(columns)
            ):
                raise BackupError(DAMAGED)
            yield ("table", name, columns)
        elif isinstance(record, dict) and set(record) == {"end"}:
            rows = record["end"].get("rows") if isinstance(record["end"], dict) else None
            if not isinstance(rows, int) or isinstance(rows, bool):
                raise BackupError(DAMAGED)
            yield ("end", rows)
            ended = True
        else:
            raise BackupError(DAMAGED)
    if not ended:
        raise BackupError(DAMAGED)


def _manifest(manifest: Any, email: str) -> dict:
    if not isinstance(manifest, dict) or manifest.get("format") != "oraiza-backup":
        raise BackupError(DAMAGED)
    if manifest.get("version") != FORMAT:
        raise BackupError(TOO_NEW, "backup_too_new")
    # The key is tied to the email already; this is the second, plain check.
    if manifest.get("owner_email") != email:
        raise BackupError(NOT_YOURS, "backup_not_yours")
    for key in ("company", "created_at", "created_by"):
        if not isinstance(manifest.get(key), str):
            raise BackupError(DAMAGED)
    _as_uuid(manifest.get("company_id"))
    _as_uuid(manifest.get("made_by_id"))
    branches = manifest.get("branches")
    if not isinstance(branches, list):
        raise BackupError(DAMAGED)
    name_type = Branch.__table__.c.name.type
    name = _as_str(name_type.length if isinstance(name_type, String) else None)
    for branch in branches:
        if not isinstance(branch, dict):
            raise BackupError(DAMAGED)
        _as_uuid(branch.get("id"))
        name(branch.get("name"))
        _as_bool(branch.get("is_main_branch"))
        _as_bool(branch.get("is_active"))
        if branch.get("address") is not None:
            _as_str(None)(branch["address"])
        if branch.get("deleted_at") is not None:
            _as_datetime(branch["deleted_at"])
    return manifest


# ── values ────────────────────────────────────────────────────────────────────


def _encode(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str, dict, list)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, memoryview)):
        return base64.b64encode(bytes(value)).decode("ascii")
    raise TypeError(f"can't put a {type(value).__name__} in a backup")


def _bad() -> BackupError:
    return BackupError(DAMAGED)


def _as_uuid(value: Any) -> uuid.UUID:
    if not isinstance(value, str):
        raise _bad()
    try:
        return uuid.UUID(value)
    except ValueError:
        raise _bad() from None


def _as_bool(value: Any) -> bool:
    if not isinstance(value, bool):
        raise _bad()
    return value


def _as_int(value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise _bad()
    return value


def _as_decimal(value: Any) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise _bad()
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise _bad() from None
    if not number.is_finite():
        raise _bad()
    return number


def _as_datetime(value: Any) -> datetime:
    if not isinstance(value, str):
        raise _bad()
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        raise _bad() from None
    if moment.tzinfo is None:
        raise _bad()
    return moment


def _as_date(value: Any) -> date:
    if not isinstance(value, str):
        raise _bad()
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise _bad() from None


def _as_bytes(value: Any) -> bytes:
    if not isinstance(value, str):
        raise _bad()
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise _bad() from None


def _as_json(value: Any) -> Any:
    return value  # already parsed, and only ever stored as JSON


def _as_str(length: int | None) -> Callable[[Any], str]:
    def decode(value: Any) -> str:
        if not isinstance(value, str) or (length is not None and len(value) > length):
            raise _bad()
        return value

    return decode


def decoder(column: Column) -> Callable[[Any], Any]:
    """How a value from the file becomes a value for ``column``. Order matters:
    Text is a String, and the JSON check comes before String for the same reason."""
    kind = column.type
    if isinstance(kind, Uuid):
        return _as_uuid
    if isinstance(kind, Boolean):
        return _as_bool
    if isinstance(kind, Integer):
        return _as_int
    if isinstance(kind, Numeric):
        return _as_decimal
    if isinstance(kind, DateTime):
        return _as_datetime
    if isinstance(kind, Date):
        return _as_date
    if isinstance(kind, LargeBinary):
        return _as_bytes
    if isinstance(kind, JSON):
        return _as_json
    if isinstance(kind, String):
        return _as_str(kind.length)
    raise RuntimeError(f"no backup decoder for {column.table.name}.{column.name} ({kind!r})")


def outside_reference(column: Column) -> str | None:
    """The shared table ``column`` points into, if any: "companies", "users" or
    "branches". Any other shared table is a decision nobody has made yet."""
    targets = {fk.column.table.name for fk in column.foreign_keys} & PUBLIC_TABLE_NAMES
    if not targets:
        return None
    [target] = targets
    if target not in {"companies", "users", "branches"}:
        raise RuntimeError(f"{column.table.name}.{column.name} refers to public.{target}; decide how a load treats it")
    return target


# ── making one ────────────────────────────────────────────────────────────────


def build(db: Session, company: Company, *, made_by: User, now: datetime) -> Backup:
    """Write the sealed file, tied to ``made_by``'s email. ``db`` must already
    be scoped to ``company``'s schema."""
    email = owner_email(made_by)
    if email is None:
        raise BackupError(NO_EMAIL, "backup_no_email")
    schema = _require_scope(db, company)
    branches = db.scalars(select(Branch).where(Branch.company_id == company.id).order_by(Branch.id)).all()
    file = tempfile.SpooledTemporaryFile(max_size=_IN_MEMORY_BYTES)
    try:
        sealed = _SealedWriter(file, email)

        def put(record: Any) -> None:
            line = json.dumps(record, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            sealed.write(line.encode("utf-8") + b"\n")

        put(
            {
                "manifest": {
                    "format": "oraiza-backup",
                    "version": FORMAT,
                    "company_id": str(company.id),
                    "company": company.name,
                    "created_at": now.isoformat(),
                    "created_by": made_by.username,
                    "made_by_id": str(made_by.id),
                    "owner_email": email,
                    "branches": [
                        {
                            "id": str(b.id),
                            "name": b.name,
                            "address": b.address,
                            "is_main_branch": bool(b.is_main_branch),
                            "is_active": bool(b.is_active),
                            "deleted_at": _encode(b.deleted_at),
                        }
                        for b in branches
                    ],
                    "schema_version": list(health.code_heads()),
                }
            }
        )
        rows = 0
        for table in backup_tables():
            columns = list(table.columns)
            put({"table": table.name, "columns": [c.name for c in columns]})
            stmt = select(*columns).order_by(*table.primary_key.columns)
            if "company_id" in table.c:
                # The mill's own rows and its copy of the shared catalogs.
                stmt = stmt.where((table.c.company_id == company.id) | table.c.company_id.is_(None))
            options = {**_in_schema(schema), "yield_per": _BATCH}
            for row in db.execute(stmt, execution_options=options):
                put([_encode(value) for value in row])
                rows += 1
        put({"end": {"rows": rows}})
        sealed.close()
    except BaseException:
        file.close()
        raise
    return Backup(file=file, filename=f"{_slug(company.name)}-backup-{now:%Y-%m-%d}{EXTENSION}", rows=rows)


# ── where one may be loaded ───────────────────────────────────────────────────


def check_owner(owner: User) -> str:
    """The owner's confirmed email, which a backup must have been made under."""
    email = owner_email(owner)
    if email is None or not owner.email_verified:
        raise BackupError(UNVERIFIED, "backup_email_unverified")
    return email


def is_empty(db: Session, company: Company) -> bool:
    """Whether the mill has nothing of its own yet: no rows but the shared
    catalogs', the default expense categories every mill starts with, and the
    app's own bookkeeping."""
    options = _in_schema(_require_scope(db, company))
    for table in backup_tables():
        if table.name in BOOKKEEPING_TABLES:
            continue
        stmt = select(literal(1)).select_from(table)
        if "company_id" in table.c:
            stmt = stmt.where(table.c.company_id.is_not(None))
        if table.name == "expense_categories":
            stmt = stmt.where(table.c.is_default.is_(False))
        if db.execute(stmt.limit(1), execution_options=options).first() is not None:
            return False
    return True


def _require_empty(db: Session, company: Company) -> None:
    if not is_empty(db, company):
        raise BackupError(NOT_EMPTY, "backup_not_empty")


def _require_new_username(owner: User, manifest: dict) -> None:
    if owner.username.strip().lower() == manifest["created_by"].strip().lower():
        raise BackupError(SAME_USERNAME, "backup_same_login")


def _require_new_password(db: Session, manifest: dict, password: str) -> None:
    """The old account's password doesn't open the new one, when that account
    is still around to ask."""
    old = db.get(User, uuid.UUID(manifest["made_by_id"]))
    if old is not None and old.password_hash and verify_password(password, old.password_hash):
        raise BackupError(SAME_PASSWORD, "backup_same_login")


def _live(branch: dict) -> bool:
    return branch.get("deleted_at") is None


def _plan_branches(
    db: Session, company: Company, owner: User, manifest: dict, *, enforce_limit: bool = True
) -> tuple[dict, list[dict]]:
    """Which of the account's branches each of the backup's becomes, and which
    to create. The old main branch becomes the account's main branch. Refuses
    when the plan has no room for the rest, unless ``enforce_limit`` is off
    (the platform admin, who sets the plan)."""
    current = db.scalars(select(Branch).where(Branch.company_id == company.id)).all()
    by_id = {b.id: b for b in current}
    live_now = [b for b in current if b.deleted_at is None]
    main = next((b for b in live_now if b.is_main_branch), live_now[0] if live_now else None)
    mapping: dict[uuid.UUID, uuid.UUID] = {}
    create: list[dict] = []
    for branch in manifest["branches"]:
        old = uuid.UUID(branch["id"])
        if old in by_id:
            mapping[old] = old
        elif branch["is_main_branch"] and main is not None and main.id not in mapping.values():
            mapping[old] = main.id
        else:
            create.append(branch)

    if not enforce_limit:
        return mapping, create
    total = len(live_now) + sum(1 for b in create if _live(b))
    allowed = None
    if "multi_branch" not in get_user_features(owner, db):
        allowed = 1
    else:
        sub = db.scalars(select(Subscription).where(Subscription.company_id == company.id)).first()
        if sub is not None and sub.plan is not None and sub.plan.max_branches is not None:
            allowed = sub.plan.max_branches
    if allowed is not None and total > allowed:
        plural = "branch" if allowed == 1 else "branches"
        raise BackupError(
            f"Your plan allows {allowed} {plural}, and this backup has {total}. "
            "Upgrade your plan, then upload the backup again.",
            "backup_branch_limit",
        )
    return mapping, create


# ── reading one ───────────────────────────────────────────────────────────────


def inspect(db: Session, company: Company, owner: User, file: IO[bytes]) -> Summary:
    """Check that the backup would load here, reading the whole file, and say
    what it holds. Writes nothing."""
    return _inspect(db, company, owner, file, check_owner(owner), as_owner=True)


def _inspect(db: Session, company: Company, owner: User, file: IO[bytes], email: str, *, as_owner: bool) -> Summary:
    _require_empty(db, company)
    manifest: dict = {}
    rows = tables = 0
    for event in _events(file, email):
        if event[0] == "manifest":
            manifest = event[1]
            if as_owner:
                _require_new_username(owner, manifest)
            _plan_branches(db, company, owner, manifest, enforce_limit=as_owner)
        elif event[0] == "table":
            tables += 1
        elif event[0] == "row":
            rows += 1
        elif event[1] != rows:
            raise BackupError(DAMAGED)
    return _summary(manifest, rows, tables)


def _summary(manifest: dict, rows: int, tables: int) -> Summary:
    branches = sum(1 for b in manifest["branches"] if _live(b))
    return Summary(manifest["company"], manifest["created_at"], manifest["created_by"], rows, tables, branches)


class _TableLoad:
    """One table's rows from the file, decoded, moved to this account and
    inserted in batches."""

    def __init__(
        self,
        db: Session,
        table: Table,
        columns: list[str],
        *,
        maps: dict[str, dict[uuid.UUID, uuid.UUID]],
        options: dict[str, Any],
    ) -> None:
        self.db, self.table, self.width, self.options, self.maps = db, table, len(columns), options, maps
        if "id" not in columns:
            raise BackupError(DAMAGED)
        # A column dropped since the backup was made is left out; one added
        # since must be able to start empty or from its default.
        self.kept = [(i, table.c[name], decoder(table.c[name])) for i, name in enumerate(columns) if name in table.c]
        for column in table.columns:
            if column.name not in columns and not (
                column.nullable or column.default is not None or column.server_default is not None
            ):
                raise BackupError(TOO_OLD, "backup_too_old")
        references = [(column, outside_reference(column)) for _, column, _ in self.kept]
        self.outside = [(column, target) for column, target in references if target]
        self.user_lists = [column for _, column, _ in self.kept if (table.name, column.name) in _USER_ID_LISTS]
        self.self_refs = [
            column for _, column, _ in self.kept if any(fk.column.table is table for fk in column.foreign_keys)
        ]
        self.batch: list[dict[str, Any]] = []
        self.parents: list[dict[str, Any]] = []

    def add(self, values: list) -> None:
        if len(values) != self.width:
            raise BackupError(DAMAGED)
        row = {column.name: None if values[i] is None else decode(values[i]) for i, column, decode in self.kept}
        for column, target in self.outside:
            value = row[column.name]
            if value is None:
                continue
            moved = self.maps[target].get(value)
            if moved is not None:
                row[column.name] = moved
            elif target == "companies":
                # Only the old mill's own id belongs in its records.
                raise BackupError(NOT_YOURS, "backup_not_yours")
            elif column.nullable:
                # Someone, or a branch, that isn't this account's.
                row[column.name] = None
            else:
                return
        for column in self.user_lists:
            ids = row[column.name]
            if isinstance(ids, list):
                users = self.maps["users"]
                known = (users.get(old) for old in map(_maybe_uuid, ids) if old is not None)
                row[column.name] = [str(user_id) for user_id in known if user_id is not None]
        for column in self.self_refs:
            # Rows can come before the row they point to: link them up at the end.
            if row[column.name] is not None:
                self.parents.append({"_id": row["id"], "_column": column.name, "_value": row[column.name]})
                row[column.name] = None
        self.batch.append(row)
        if len(self.batch) >= _BATCH:
            self.flush()

    def flush(self) -> None:
        if self.batch:
            self.db.execute(self.table.insert(), self.batch, execution_options=self.options)
            self.batch = []

    def finish(self) -> None:
        self.flush()
        for column in self.self_refs:
            links = [{"_id": p["_id"], "_value": p["_value"]} for p in self.parents if p["_column"] == column.name]
            if links:
                stmt = (
                    self.table.update()
                    .where(self.table.c.id == bindparam("_id"))
                    .values({column.name: bindparam("_value")})
                )
                self.db.execute(stmt, links, execution_options=self.options)


def _maybe_uuid(raw: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(raw))
    except ValueError:
        return None


def _lock(db: Session, schema: str, tables: list[Table]) -> None:
    """Hold off every other write to the mill's tables until the load commits.
    Reads go on. Waiting more than a few seconds means someone is mid-save."""
    db.execute(text("SET LOCAL lock_timeout = '10s'"))
    # Identifiers can't be bound parameters: the schema was validated and the
    # table names are our own models'.
    names = ", ".join(f'"{schema}"."{table.name}"' for table in tables)
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    db.execute(text(f"LOCK TABLE {names} IN EXCLUSIVE MODE"))


def restore(db: Session, company: Company, owner: User, file: IO[bytes], *, password: str) -> Summary:
    """Load the backup into this empty account, as ``owner`` (who typed
    ``password`` to confirm it).

    Doesn't commit: the caller commits on success and rolls back on any error,
    which leaves the account exactly as it was. ``db`` must be scoped to
    ``company``'s schema."""
    return _restore(db, company, owner, file, check_owner(owner), password=password)


def _restore(
    db: Session, company: Company, owner: User, file: IO[bytes], email: str, *, password: str | None
) -> Summary:
    """The load itself. ``password`` is None for the platform admin, which also
    skips the owner's checks (new login, plan limit); see restore_as_admin."""
    as_owner = password is not None
    schema = _require_scope(db, company)
    _require_empty(db, company)  # before reading a byte: the cheap answer first
    options = _in_schema(schema)
    tables = backup_tables()
    by_name = {table.name: table for table in tables}
    events = _events(file, email)
    # The first segment and the manifest are checked before anything changes.
    _, manifest = next(events)
    if as_owner:
        _require_new_username(owner, manifest)
        _require_new_password(db, manifest, password or "")

    _lock(db, schema, tables)
    _require_empty(db, company)  # again, now that nobody else can write
    branches, create = _plan_branches(db, company, owner, manifest, enforce_limit=as_owner)
    for branch in create:
        made = Branch(
            company_id=company.id,
            name=branch["name"],
            address=branch.get("address"),
            is_main_branch=False,
            is_active=branch["is_active"],
            deleted_at=_as_datetime(branch["deleted_at"]) if branch.get("deleted_at") else None,
        )
        db.add(made)
        db.flush()
        branches[uuid.UUID(branch["id"])] = made.id
    live = db.scalar(
        select(func.count()).select_from(Branch).where(Branch.company_id == company.id, Branch.deleted_at.is_(None))
    )
    if (live or 0) > 1:
        company.is_multi_branch = True

    old_company = uuid.UUID(manifest["company_id"])
    users = {user_id: user_id for user_id in db.scalars(select(User.id).where(User.company_id == company.id))}
    users[uuid.UUID(manifest["made_by_id"])] = owner.id
    maps = {"companies": {old_company: company.id}, "users": users, "branches": branches}

    for table in reversed(tables):
        for column in table.columns:
            if any(fk.column.table is table for fk in column.foreign_keys):
                db.execute(table.update().values({column.name: None}), execution_options=options)
        db.execute(table.delete(), execution_options=options)

    seen: set[str] = set()
    load: _TableLoad | None = None
    rows = 0
    try:
        for event in events:
            if event[0] == "table":
                if load:
                    load.finish()
                name, columns = event[1], event[2]
                if name in seen:
                    raise BackupError(DAMAGED)
                seen.add(name)
                table = by_name.get(name)
                # A table this version no longer has is skipped. So is any name
                # that isn't one of the mill's own tables: nothing else is written.
                load = _TableLoad(db, table, columns, maps=maps, options=options) if table is not None else None
            elif event[0] == "row":
                rows += 1
                if load:
                    load.add(event[1])
            elif event[1] != rows:
                raise BackupError(DAMAGED)
        if load:
            load.finish()
    except (IntegrityError, DataError):
        raise BackupError(DOESNT_FIT, "backup_doesnt_fit") from None
    # The load replaced the default expense categories with the backup's; one
    # made before there were defaults marks none, so mark them again.
    seed_default_expense_categories(db, company.id)
    return _summary(manifest, rows, len(seen))


# ── loading one as the platform admin ─────────────────────────────────────────
#
# BossAdmin loads a backup into an empty tenant without the owner's checks: the
# account's email needn't be confirmed or match, there's no new username or
# password to insist on (nobody signs in as the old owner here), and no branch
# limit (the admin sets the plan). What stays: the tenant must be empty, and
# the file must open, whole and unchanged, for the email it was made for.
# The backup's maker becomes the tenant's Boss.

ADMIN_NO_EMAIL = "Enter the email address of the owner who downloaded the backup: the file opens only for it."
ADMIN_NO_BOSS = "This tenant has no Boss login to own the records. Restore the Boss first, then load the backup."
ADMIN_NOT_YOURS = (
    "This backup doesn't open for that email address, or it was changed after it was downloaded. "
    "Enter the email of the owner who downloaded it."
)
ADMIN_NOT_EMPTY = "This tenant already has records of its own. A backup loads only into an empty tenant."
_ADMIN_WORDS = {"backup_not_yours": ADMIN_NOT_YOURS, "backup_not_empty": ADMIN_NOT_EMPTY}


def tenant_boss(db: Session, company: Company) -> User | None:
    """The tenant's Boss: its first active owner login."""
    return db.scalars(
        select(User)
        .join(Role, User.role_id == Role.id)
        .where(User.company_id == company.id, Role.name == "owner", User.is_active.is_(True))
        .order_by(User.created_at)
    ).first()


def _for_admin(db: Session, company: Company, email: str | None) -> tuple[User, str]:
    boss = tenant_boss(db, company)
    if boss is None:
        raise BackupError(ADMIN_NO_BOSS, "backup_no_owner")
    address = (email or "").strip().lower() or owner_email(boss)
    if not address:
        raise BackupError(ADMIN_NO_EMAIL, "backup_no_email")
    return boss, address


def _in_admin_words(error: BackupError) -> BackupError:
    words = _ADMIN_WORDS.get(error.code)
    return BackupError(words, error.code) if words else error


def inspect_as_admin(db: Session, company: Company, file: IO[bytes], *, email: str | None) -> Summary:
    """inspect, for the platform admin. ``email`` is what the file was made for;
    the tenant Boss's own when left out. Writes nothing."""
    try:
        boss, address = _for_admin(db, company, email)
        return _inspect(db, company, boss, file, address, as_owner=False)
    except BackupError as e:
        raise _in_admin_words(e) from None


def restore_as_admin(db: Session, company: Company, file: IO[bytes], *, email: str | None) -> tuple[Summary, User]:
    """restore, for the platform admin; returns the summary and the Boss who now
    owns the records. Doesn't commit, as restore."""
    try:
        boss, address = _for_admin(db, company, email)
        return _restore(db, company, boss, file, address, password=None), boss
    except BackupError as e:
        raise _in_admin_words(e) from None
