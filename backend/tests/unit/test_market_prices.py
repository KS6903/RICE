"""Reading public prices from what their publishers actually send, with no network."""

from __future__ import annotations

import io
import zipfile

import httpx
import pytest

from app.services import market_prices as market
from app.services.market_prices import read_openstat_csv, read_pink_sheet, tariff_for_price

MAIN = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'


def _workbook() -> bytes:
    """A small workbook laid out as the World Bank's: names as shared strings, a months column."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as book:
        book.writestr(
            "xl/workbook.xml",
            f'<workbook {MAIN} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="AFOSHEET" r:id="rId1"/><sheet name="Monthly Prices" r:id="rId2"/></sheets></workbook>',
        )
        book.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
        )
        book.writestr(
            "xl/sharedStrings.xml",
            f"<sst {MAIN}><si><t>Rice, Viet Namese 5%</t></si><si><t>2026M08</t></si>"
            "<si><t>2026M09</t></si><si><t>2026M10</t></si><si><t>…</t></si></sst>",
        )
        book.writestr("xl/worksheets/sheet1.xml", f"<worksheet {MAIN}><sheetData/></worksheet>")
        book.writestr(
            "xl/worksheets/sheet2.xml",
            f"<worksheet {MAIN}><sheetData>"
            '<row r="5"><c r="C5" t="s"><v>0</v></c></row>'
            '<row r="6"><c r="A6" t="s"><v>1</v></c><c r="C6"><v>410.9</v></c></row>'
            '<row r="7"><c r="A7" t="s"><v>2</v></c><c r="C7"><v>418.5</v></c></row>'
            '<row r="8"><c r="A8" t="s"><v>3</v></c><c r="C8" t="s"><v>4</v></c></row>'
            "</sheetData></worksheet>",
        )
    return buf.getvalue()


def test_pink_sheet_gives_the_latest_month_with_a_price():
    assert read_pink_sheet(_workbook()) == {"usd_per_ton": 418.5, "month": "2026-09"}


def test_pink_sheet_without_the_column_gives_nothing():
    assert read_pink_sheet(_workbook(), column="Rice, Thai 5%") is None


def test_openstat_csv_takes_each_commoditys_latest_month():
    text = (
        '"Geolocation","Commodity","2026 January","2026 September","2026 October","2026 Annual"\n'
        '"PHILIPPINES","Palay [Paddy] Fancy, dry (conv. to 14% mc)",21.70,19.11,..,..\n'
        '"Philippines","RICE, WELL-MILLED, 1 KG",50.05,55.68,.,.\n'
    )
    assert read_openstat_csv(text) == {
        "Palay [Paddy] Fancy, dry (conv. to 14% mc)": {"per_kg": 19.11, "month": "2026-09"},
        "RICE, WELL-MILLED, 1 KG": {"per_kg": 55.68, "month": "2026-09"},
    }


@pytest.mark.parametrize(
    ("price", "rate"),
    [(418.5, 15.0), (368, 15.0), (367.9, 20.0), (350, 20.0), (349, 25.0), (332, 25.0), (331, 30.0), (316, 30.0), (315, 35.0)],
)
def test_tariff_follows_the_circulars_table(price, rate):
    assert tariff_for_price(price) == rate


def test_a_source_thats_down_leaves_only_its_own_figure_empty(monkeypatch):
    monkeypatch.setattr(market.cache, "get_json", lambda key: None)
    monkeypatch.setattr(market.cache, "set_json", lambda key, value, ttl: None)
    monkeypatch.setattr(market, "_fetch_vietnam_price", lambda client: {"usd_per_ton": 349.0, "month": "2026-09"})
    monkeypatch.setattr(market, "_fetch_openstat", lambda client, table, names: [])

    def down(client):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(market, "_fetch_fx", down)
    prices = market.market_prices()
    assert prices["usd_php"] is None
    assert prices["vietnam_5pct"]["usd_per_ton"] == 349.0
    assert prices["table_tariff_pct"] == 25.0
    assert prices["palay_farmgate"] == []
