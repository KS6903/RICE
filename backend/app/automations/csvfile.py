"""CSV files for emailed reports and the data export, made to open cleanly in
Excel.

UTF-8 with a byte-order mark, so Excel shows ₱ and ñ instead of mojibake.
Text cells that a spreadsheet would read as a formula (=, +, -, @, tab, CR at
the start) get a leading apostrophe: a customer named "=HYPERLINK(...)" must
not become a live formula in the owner's spreadsheet. Numbers are left alone.
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable, Sequence
from datetime import date
from decimal import Decimal
from typing import TextIO

from ..core.mailer import Attachment

_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def _cell(value: object) -> object:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int, float, Decimal)):
        return value
    if isinstance(value, date):
        return value.isoformat()
    text = json.dumps(value, ensure_ascii=False, default=str) if isinstance(value, (dict, list)) else str(value)
    return "'" + text if text.startswith(_FORMULA_START) else text


def write_csv(out: TextIO, header: Sequence[str], rows: Iterable[Sequence[object]]) -> int:
    """Write the header and rows to ``out``; return how many rows."""
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow([_cell(h) for h in header])
    count = 0
    for row in rows:
        writer.writerow([_cell(v) for v in row])
        count += 1
    return count


def csv_attachment(filename: str, header: Sequence[str], rows: Iterable[Sequence[object]]) -> Attachment:
    out = io.StringIO()
    write_csv(out, header, rows)
    return Attachment(filename=filename, content=out.getvalue().encode("utf-8-sig"), mime_type="text/csv")
