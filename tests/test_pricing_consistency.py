"""Shown = charged: prices on /pricing, /data and /patrons must equal the amounts the checkout functions charge."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


def _cents(js: str, key: str) -> int:
    m = re.search(rf"\b{key}\s*:\s*(?:\{{\s*amount\s*:\s*)?(\d+)", js)
    assert m, f"{key} not found"
    return int(m.group(1))


def _charged():
    patron = (WEB / "api" / "create-checkout.js").read_text()
    data = (WEB / "api" / "create-data-checkout.js").read_text()
    return {
        "Supporter": _cents(patron, "supporter"),
        "Sustainer": _cents(patron, "sustainer"),
        "Founding Patron": _cents(patron, "founding"),
        "Journalist / Researcher": _cents(data, "journalist"),
        "Commercial License": _cents(data, "commercial"),
    }


def _shown(html: str):
    pairs = re.findall(
        r'<span class="tier-name">([^<]+)</span>\s*<span class="tier-price">\$([\d,]+)</span>', html
    )
    return {name.strip(): int(price.replace(",", "")) * 100 for name, price in pairs}


def test_pricing_page_lists_every_tier_at_the_charged_amount():
    shown = _shown((WEB / "pricing" / "index.html").read_text())
    assert shown == _charged()


def test_data_and_patron_pages_match_charged_amounts():
    charged = _charged()
    for page in ("data", "patrons"):
        for name, cents in _shown((WEB / page / "index.html").read_text()).items():
            assert charged[name] == cents, (page, name)


def test_no_free_tier_language_on_pricing_or_landing():
    for page in ("pricing/index.html", "index.html"):
        text = re.sub(r"<[^>]+>", " ", (WEB / page).read_text())
        assert not re.search(r"\bfree\b", text, re.I), page


def test_landing_has_one_primary_cta_to_data():
    html = (WEB / "index.html").read_text()
    assert html.count('class="hero-cta-btn"') == 1
    assert re.search(r'<a href="/data/" class="hero-cta-btn">Get the data</a>', html)
