"""Public prices for the Savings page, read from who publishes them, so the Boss doesn't
have to look them up: Vietnam 5% broken rice (World Bank's monthly Pink Sheet), the
dollar (European Central Bank, through Frankfurter), and Philippine palay and retail
rice (PSA OpenSTAT).

There's no public feed of Philippine wholesale rice: PSA's table stops at 2021. So that
figure stays typed, or falls back on the mill's own sales.

Each source is cached on its own, and one that's down just leaves its figure empty.
"""

from __future__ import annotations

import csv
import io
import logging
import re
import zipfile
from typing import Any, Callable
from xml.etree import ElementTree

import httpx

from ..core.cache import TTL_MARKET_PRICES, TTL_MARKET_PRICES_FAILED, cache

logger = logging.getLogger(__name__)

PINK_SHEET_PAGE = "https://www.worldbank.org/en/research/commodity-markets"
PINK_SHEET_FILE = re.compile(r"https://thedocs\.worldbank\.org/[^\"'\s]+CMO-Historical-Data-Monthly\.xlsx")
PINK_SHEET_COLUMN = "Rice, Viet Namese 5%"
FX_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP"
OPENSTAT = "https://openstat.psa.gov.ph/PXWeb/api/v1/en/DB/2M"
PALAY_TABLE = f"{OPENSTAT}/NFG/0032M4AFN01.px"
RETAIL_TABLE = f"{OPENSTAT}/2018NEW/0042M4ARN01.px"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Oraiza rice mill app)"}
MAX_DOWNLOAD_BYTES = 20_000_000
MAX_SHEET_BYTES = 200_000_000

# IAGRTA Circular 2025-001 under EO 105 (2025): at or above this Vietnam 5% FOB price,
# this tariff. Under the last line, 35%. The rate in force is what customs last ordered,
# and in January 2026 the DA kept 15% with the price inside the 20% band, so this is
# what the table says, not what's charged.
TARIFF_BANDS = ((368.0, 15.0), (350.0, 20.0), (332.0, 25.0), (316.0, 30.0))
TARIFF_FLOOR_RATE = 35.0

_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def tariff_for_price(usd_per_ton: float) -> float:
    for floor, rate in TARIFF_BANDS:
        if usd_per_ton >= floor:
            return rate
    return TARIFF_FLOOR_RATE


def _column(cell_ref: str) -> str:
    return re.sub(r"\d", "", cell_ref)


def _cell_text(cell: ElementTree.Element, shared: list[str]) -> str | None:
    if cell.get("t") == "inlineStr":
        return "".join(t.text or "" for t in cell.iter(f"{_MAIN}t"))
    value = cell.find(f"{_MAIN}v")
    if value is None or value.text is None:
        return None
    return shared[int(value.text)] if cell.get("t") == "s" else value.text


def _read_member(book: zipfile.ZipFile, name: str) -> bytes:
    if book.getinfo(name).file_size > MAX_SHEET_BYTES:
        raise ValueError(f"{name} is too large")
    return book.read(name)


def _parse_xml(xml: bytes) -> ElementTree.Element:
    """A part of a downloaded workbook. XML attacks need a DTD, and a workbook never has
    one, so one that does is refused. A NUL means another encoding, which could hide it."""
    if b"\x00" in xml or b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
        raise ValueError("the workbook's XML has a DTD")
    return ElementTree.fromstring(xml)  # nosec B314


def read_pink_sheet(content: bytes, column: str = PINK_SHEET_COLUMN) -> dict | None:
    """The latest month with a price in the workbook's Monthly Prices sheet."""
    with zipfile.ZipFile(io.BytesIO(content)) as book:
        shared = []
        if "xl/sharedStrings.xml" in book.namelist():
            for item in _parse_xml(_read_member(book, "xl/sharedStrings.xml")):
                shared.append("".join(t.text or "" for t in item.iter(f"{_MAIN}t")))
        workbook = _parse_xml(_read_member(book, "xl/workbook.xml"))
        sheet_id = next(
            (s.get(f"{_REL}id") for s in workbook.iter(f"{_MAIN}sheet") if s.get("name") == "Monthly Prices"), None
        )
        rels = _parse_xml(_read_member(book, "xl/_rels/workbook.xml.rels"))
        target = next((r.get("Target") for r in rels if r.get("Id") == sheet_id), None)
        if target is None:
            return None
        sheet = _parse_xml(_read_member(book, "xl/" + target.lstrip("/").removeprefix("xl/")))

    price_column = None
    latest = None
    for row in sheet.iter(f"{_MAIN}row"):
        cells = {_column(c.get("r", "")): _cell_text(c, shared) for c in row}
        if price_column is None:
            price_column = next((k for k, v in cells.items() if (v or "").strip() == column), None)
            continue
        month = re.fullmatch(r"(\d{4})M(\d{2})", (cells.get("A") or "").strip())
        if not month:
            continue
        try:
            price = float(cells.get(price_column) or "")
        except ValueError:  # the sheet marks a month without a figure with "…"
            continue
        latest = {"usd_per_ton": price, "month": f"{month[1]}-{month[2]}"}
    return latest


def read_openstat_csv(text: str) -> dict[str, dict]:
    """A commodity's latest month with a price, from an OpenSTAT table of one year."""
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    out: dict[str, dict] = {}
    if not rows:
        return out
    months = rows[0][2:]
    for row in rows[1:]:
        for heading, value in zip(months, row[2:]):
            try:
                price = float(value)
            except ValueError:  # ".." or "." for a month not out yet
                continue
            year, month_name = heading.rsplit(" ", 1)
            if month_name in _MONTHS:
                out[row[1]] = {"per_kg": price, "month": f"{year}-{_MONTHS.index(month_name) + 1:02d}"}
    return out


def _fetch_vietnam_price(client: httpx.Client) -> dict | None:
    page = client.get(PINK_SHEET_PAGE)
    page.raise_for_status()
    link = PINK_SHEET_FILE.search(page.text)
    if not link:
        raise ValueError("no Pink Sheet link on the World Bank's page")
    book = client.get(link[0])
    book.raise_for_status()
    if len(book.content) > MAX_DOWNLOAD_BYTES:
        raise ValueError("the Pink Sheet is too large")
    return read_pink_sheet(book.content)


def _fetch_fx(client: httpx.Client) -> dict | None:
    res = client.get(FX_URL)
    res.raise_for_status()
    body = res.json()
    return {"rate": float(body["rates"]["PHP"]), "date": body["date"]}


def _fetch_openstat(client: httpx.Client, table: str, commodities: dict[str, str]) -> list[dict]:
    """``commodities``: the table's name for each, to the name we show."""
    shape = client.get(table)
    shape.raise_for_status()
    query = []
    for var in shape.json()["variables"]:
        heading, values, texts = var["text"].lower(), var["values"], var["valueTexts"]
        if "year" in heading:
            chosen = values[-1:]
        elif "geo" in heading:
            chosen = values[:1]  # the whole country comes first
        elif "commodity" in heading:
            chosen = [v for v, text in zip(values, texts) if text in commodities]
        else:
            chosen = values
        query.append({"code": var["code"], "selection": {"filter": "item", "values": chosen}})
    res = client.post(table, json={"query": query, "response": {"format": "csv"}})
    res.raise_for_status()
    prices = read_openstat_csv(res.content.decode("utf-8-sig"))
    return [{"name": name, **prices[key]} for key, name in commodities.items() if key in prices]


def _cached(key: str, fetch: Callable[[], Any]) -> Any:
    hit = cache.get_json(key)
    if hit is not None:
        return hit.get("value")
    try:
        value = fetch()
    except (httpx.HTTPError, ValueError, KeyError, IndexError, zipfile.BadZipFile, ElementTree.ParseError) as e:
        logger.warning("market price %s unavailable: %s", key, e)
        value = None
    # A source that's down is asked again soon, not on every page load.
    cache.set_json(key, {"value": value}, TTL_MARKET_PRICES if value else TTL_MARKET_PRICES_FAILED)
    return value


def market_prices() -> dict:
    with httpx.Client(timeout=15.0, headers=HEADERS, follow_redirects=True) as client:
        vietnam = _cached("market:vietnam5", lambda: _fetch_vietnam_price(client))
        fx = _cached("market:usdphp", lambda: _fetch_fx(client))
        palay = _cached(
            "market:palay",
            lambda: _fetch_openstat(
                client,
                PALAY_TABLE,
                {
                    "Palay [Paddy] Fancy, dry (conv. to 14% mc)": "Palay, fancy",
                    "Palay [Paddy] Other Variety, dry (conv. to 14% mc)": "Palay, other varieties",
                },
            ),
        )
        retail = _cached(
            "market:retail",
            lambda: _fetch_openstat(
                client,
                RETAIL_TABLE,
                {
                    "RICE, REGULAR-MILLED, 1 KG": "Rice, regular-milled",
                    "RICE, WELL-MILLED, 1 KG": "Rice, well-milled",
                    "RICE, SPECIAL, 1 KG": "Rice, special",
                },
            ),
        )
    return {
        "vietnam_5pct": vietnam,
        "table_tariff_pct": tariff_for_price(vietnam["usd_per_ton"]) if vietnam else None,
        "usd_php": fx,
        "palay_farmgate": palay or [],
        "rice_retail": retail or [],
    }
