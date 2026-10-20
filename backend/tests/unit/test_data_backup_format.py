"""The backup file: unreadable to anyone but us, and any change to it, or a
file made under another owner's email, is refused before a record is used."""

from __future__ import annotations

import io
import json
import os
import uuid
import zlib

import pytest

import app.main  # noqa: F401  (registers every model)
from app.core.crypto import derive_key
from app.services import data_backup as backup

OWNER = "owner@mill.ph"
SOMEONE_ELSE = "someone@else.ph"


def _manifest(email: str = OWNER, **changes) -> dict:
    manifest = {
        "format": "oraiza-backup",
        "version": 1,
        "company_id": str(uuid.uuid4()),
        "company": "Rice Mill 1",
        "created_at": "2026-10-20T08:00:00+00:00",
        "created_by": "mill1",
        "made_by_id": str(uuid.uuid4()),
        "owner_email": email,
        "branches": [
            {
                "id": str(uuid.uuid4()),
                "name": "Main",
                "address": None,
                "is_main_branch": True,
                "is_active": True,
                "deleted_at": None,
            }
        ],
    }
    return {"manifest": {**manifest, **changes}}


def _records(rows: int = 3, *, filler: int = 0) -> list:
    """A small backup; ``filler`` random hex per row, to span several segments."""
    body = [[str(uuid.uuid4()), f"Customer {i}", os.urandom(filler).hex()] for i in range(rows)]
    return [_manifest(), {"table": "customers", "columns": ["id", "name", "notes"]}, *body, {"end": {"rows": rows}}]


def _sealed(records: list | None = None, email: str = OWNER, *, raw: bytes | None = None) -> bytes:
    out = io.BytesIO()
    writer = backup._SealedWriter(out, email)
    if raw is not None:
        writer.write(raw)
    else:
        for record in records if records is not None else _records():
            writer.write(json.dumps(record).encode() + b"\n")
    writer.close()
    return out.getvalue()


def _events(data: bytes, email: str = OWNER) -> list:
    return list(backup._events(io.BytesIO(data), email))


def _refused(data: bytes, email: str = OWNER) -> backup.BackupError:
    with pytest.raises(backup.BackupError) as caught:
        _events(data, email)
    return caught.value


def _segments(data: bytes) -> list[bytes]:
    body = data[backup.HEADER_BYTES :]
    size = backup.SEGMENT + backup.TAG
    return [body[i : i + size] for i in range(0, len(body), size)]


BIG = _records(40, filler=4096)  # incompressible, so several segments


def test_a_backup_reads_back_as_written():
    records = _records()
    events = _events(_sealed(records))
    assert events[0] == ("manifest", records[0]["manifest"])
    assert events[1] == ("table", "customers", ["id", "name", "notes"])
    assert [e[1] for e in events[2:-1]] == records[2:-1]
    assert events[-1] == ("end", 3)


def test_nobody_can_read_it():
    data = _sealed(_records())
    assert data.startswith(backup.MAGIC)
    for plain in (b"Customer", b"customers", b"Rice Mill", OWNER.encode(), b"mill1"):
        assert plain not in data
    with pytest.raises(zlib.error):
        zlib.decompress(data[backup.HEADER_BYTES :])


def test_the_same_records_never_make_the_same_file():
    records = _records()
    assert _sealed(records)[backup.HEADER_BYTES :] != _sealed(records)[backup.HEADER_BYTES :]


def test_a_big_backup_spans_several_segments():
    data = _sealed(BIG)
    assert len(_segments(data)) >= 3
    assert len(_events(data)) == len(BIG)  # one event per record: manifest, table, rows, end


@pytest.mark.parametrize(
    "where",
    ["magic", "format", "salt", "first segment", "segment boundary", "middle", "last tag"],
)
def test_changing_any_byte_is_refused(where):
    data = bytearray(_sealed(BIG))
    seg = backup.SEGMENT + backup.TAG
    at = {
        "magic": 1,
        "format": len(backup.MAGIC),
        "salt": len(backup.MAGIC) + 5,
        "first segment": backup.HEADER_BYTES + 10,
        "segment boundary": backup.HEADER_BYTES + seg,
        "middle": len(data) // 2,
        "last tag": len(data) - 1,
    }[where]
    data[at] ^= 0x01
    _refused(bytes(data))


def test_every_sampled_byte_flip_is_refused():
    original = _sealed(BIG)
    for at in range(0, len(original), 997):
        data = bytearray(original)
        data[at] ^= 0x80
        _refused(bytes(data))


def test_cutting_it_short_is_refused():
    data = _sealed(BIG)
    last = len(_segments(data)[-1])
    for length in (backup.HEADER_BYTES, backup.HEADER_BYTES + 5, len(data) - last, len(data) - 1):
        _refused(data[:length])


def test_adding_to_it_is_refused():
    data = _sealed(BIG)
    _refused(data + b"\x00")
    _refused(data + _segments(data)[0])


def test_reordering_its_segments_is_refused():
    data = _sealed(BIG)
    first, second, *rest = _segments(data)
    _refused(data[: backup.HEADER_BYTES] + second + first + b"".join(rest))


def test_splicing_two_backups_is_refused():
    one, two = _sealed(BIG), _sealed(BIG)
    _refused(one[: backup.HEADER_BYTES] + _segments(two)[0] + b"".join(_segments(one)[1:]))


def test_a_backup_opens_only_under_its_owners_email():
    error = _refused(_sealed(_records(), OWNER), SOMEONE_ELSE)
    assert error.message == backup.NOT_YOURS
    assert _events(_sealed(_records(), OWNER), OWNER)


def test_a_file_naming_another_owner_inside_is_refused():
    records = _records()
    records[0] = _manifest(SOMEONE_ELSE)
    assert _refused(_sealed(records, OWNER), OWNER).message == backup.NOT_YOURS


@pytest.mark.parametrize(
    "data",
    [b"", b"PK\x03\x04 a zip file", os.urandom(4096), backup.MAGIC[:4]],
    ids=["empty", "zip", "random", "short"],
)
def test_other_files_are_not_backups(data):
    assert _refused(data).message == backup.NOT_A_BACKUP


def test_an_unknown_format_is_refused():
    data = bytearray(_sealed())
    data[len(backup.MAGIC)] = 2
    assert _refused(bytes(data)).message == backup.TOO_NEW


@pytest.mark.parametrize(
    "records",
    [
        [],
        [{"table": "customers", "columns": ["id"]}],
        [_manifest(), {"table": "customers", "columns": ["id"]}],  # no end
        [_manifest(), {"end": {"rows": 0}}, {"table": "customers", "columns": ["id"]}],  # after the end
        [_manifest(), {"table": "customers", "columns": ["id", "id"]}, {"end": {"rows": 0}}],
        [_manifest(), {"table": 7, "columns": ["id"]}, {"end": {"rows": 0}}],
        [_manifest(), {"something": "else"}, {"end": {"rows": 0}}],
        [_manifest(), {"end": {"rows": "0"}}],
        [_manifest(company_id="not-an-id"), {"end": {"rows": 0}}],
        [_manifest(branches="Main"), {"end": {"rows": 0}}],
        [_manifest(branches=[{"id": str(uuid.uuid4()), "name": 5}]), {"end": {"rows": 0}}],
    ],
    ids=[
        "nothing",
        "no manifest",
        "no end",
        "after end",
        "duplicate column",
        "odd name",
        "odd record",
        "odd end",
        "odd mill",
        "odd branches",
        "odd branch",
    ],
)
def test_a_sealed_file_with_the_wrong_shape_is_refused(records):
    assert _refused(_sealed(records)).message == backup.DAMAGED


def test_bytes_that_are_not_json_lines_are_refused():
    assert _refused(_sealed(raw=b"hello")).message == backup.DAMAGED
    assert _refused(_sealed(raw=b"{not json}\n")).message == backup.DAMAGED


def test_a_file_that_unpacks_too_far_is_refused(monkeypatch):
    monkeypatch.setattr(backup, "_MAX_INFLATED", 100_000)
    assert _refused(_sealed(raw=b"0" * 200_000)).code == "backup_too_big"


def test_an_endless_line_is_refused(monkeypatch):
    monkeypatch.setattr(backup, "_MAX_LINE", 1000)
    assert _refused(_sealed(raw=b"[" + b"1," * 5000)).code == "backup_too_big"


def test_keys_are_separate_per_purpose_and_per_file():
    salt = os.urandom(32)
    key = derive_key(purpose=b"oraiza/data-backup/1/a", salt=salt)
    assert key == derive_key(purpose=b"oraiza/data-backup/1/a", salt=salt)
    assert key != derive_key(purpose=b"oraiza/data-backup/1/b", salt=salt)
    assert key != derive_key(purpose=b"oraiza/data-backup/1/a", salt=os.urandom(32))
    assert len(key) == 32


def test_every_column_of_the_mills_tables_can_be_loaded():
    """A new column type, or a reference into another shared table, must be
    decided on here rather than found out during someone's load."""
    for table in backup.backup_tables():
        for column in table.columns:
            backup.decoder(column)
            backup.outside_reference(column)
            if column.name == "company_id":
                # Moved to the new mill by its foreign key, so it must have one.
                assert backup.outside_reference(column) == "companies", f"{table.name}.company_id"


def test_the_activity_log_is_never_in_a_backup():
    assert "activity_logs" not in {t.name for t in backup.backup_tables()}
    assert backup.BOOKKEEPING_TABLES <= {t.name for t in backup.backup_tables()}


def test_tables_come_parents_first():
    order = [t.name for t in backup.backup_tables()]
    for position, table in enumerate(backup.backup_tables()):
        for fk in table.foreign_keys:
            parent = fk.column.table.name
            if parent in order and parent != table.name:
                assert order.index(parent) < position, f"{table.name} before {parent}"


@pytest.mark.parametrize(
    ("decode", "bad"),
    [
        (backup._as_int, True),
        (backup._as_int, "1"),
        (backup._as_int, 1.5),
        (backup._as_bool, 1),
        (backup._as_bool, "true"),
        (backup._as_decimal, "NaN"),
        (backup._as_decimal, "Infinity"),
        (backup._as_decimal, True),
        (backup._as_decimal, "12abc"),
        (backup._as_datetime, "2026-10-20T08:00:00"),  # no time zone
        (backup._as_datetime, 20261020),
        (backup._as_date, "20/10/2026"),
        (backup._as_uuid, "not-a-uuid"),
        (backup._as_uuid, 5),
        (backup._as_bytes, "not base64!"),
        (backup._as_str(5), "too long for it"),
        (backup._as_str(None), 5),
    ],
)
def test_values_of_the_wrong_kind_are_refused(decode, bad):
    with pytest.raises(backup.BackupError):
        decode(bad)


def test_values_round_trip_through_their_encoding():
    from datetime import date, datetime, timezone
    from decimal import Decimal

    moment = datetime(2026, 10, 20, 8, 30, tzinfo=timezone.utc)
    ident = uuid.uuid4()
    assert backup._as_datetime(backup._encode(moment)) == moment
    assert backup._as_date(backup._encode(date(2026, 10, 20))) == date(2026, 10, 20)
    assert backup._as_decimal(backup._encode(Decimal("1234.50"))) == Decimal("1234.50")
    assert backup._as_uuid(backup._encode(ident)) == ident
    assert backup._as_bytes(backup._encode(b"\x00\xffreport")) == b"\x00\xffreport"
