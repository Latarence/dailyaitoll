"""A11Y-004: every built page on dailyaitoll.com has exactly one <main> landmark.

Scans ALL web/**/*.html (hand-built pages, checkout/thank-you, every dated daily page) plus the daily
template, and checks the generator's backfill on an old-shaped page (dated pages it no longer rewrites)."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import generate_daily_pages as gen  # noqa: E402

PAGES = sorted(p for p in (ROOT / "web").rglob("*.html") if "node_modules" not in p.parts)


def _main_ok(s: str) -> bool:
    opens = re.findall(r"<main\b", s, re.I)
    closes = re.findall(r"</main>", s, re.I)
    if len(opens) != 1 or len(closes) != 1:
        return False
    body, o, c, foot = s.find("<body"), s.find("<main"), s.find("</main>"), s.find("<footer")
    return 0 <= body < o < c and (foot < 0 or c < foot)


def test_every_built_page_has_one_main_landmark():
    assert len(PAGES) > 200, f"expected the full built site, found {len(PAGES)} pages"
    bad = [str(p.relative_to(ROOT)) for p in PAGES if not _main_ok(p.read_text())]
    assert not bad, f"{len(bad)} page(s) without exactly one <main> inside <body> before <footer>: {bad[:20]}"


def test_checkout_and_thank_you_have_main():
    for rel in ("web/patrons/checkout/index.html", "web/patrons/thank-you/index.html", "web/data/success/index.html"):
        assert _main_ok((ROOT / rel).read_text()), rel


def test_daily_template_has_main():
    assert _main_ok((ROOT / "scripts" / "templates" / "daily_page.html").read_text())


def test_generated_daily_page_has_main():
    html = gen.generate_daily_page("2026-01-02", [], gen.load_template())
    assert _main_ok(html)


OLD_SHAPE = """<!DOCTYPE html><html><body>
    <div class="container">
        <nav><a href="/">Home</a></nav>
        <div class="mobile-menu" id="mobileMenu">
            <div class="mobile-menu-header"><button>x</button></div>
            <div class="mobile-menu-footer"><div>t</div></div>
        </div>

        <a href="/" class="back-link">All events</a>
        <section class="record"><div class="entry">e</div></section>

        <footer><div class="footer-links">f</div></footer>
    </div>
</body></html>"""


def test_backfill_wraps_content_between_menu_and_footer():
    out = gen.add_main_landmark(OLD_SHAPE)
    assert _main_ok(out)
    inner = out[out.index("<main"):out.index("</main>")]
    assert "back-link" in inner and "record" in inner and "mobile-menu" not in inner and "<footer" not in inner
    assert gen.add_main_landmark(out) == out  # idempotent


def test_backfill_refuses_unknown_shape():
    try:
        gen.add_main_landmark("<html><body><p>no header or footer</p></body></html>")
    except ValueError:
        return
    raise AssertionError("expected ValueError for a page with no nav/footer")


def test_ensure_main_landmarks_fixes_old_dated_page(tmp_path):
    page = tmp_path / "2023" / "01" / "04" / "index.html"
    page.parent.mkdir(parents=True)
    page.write_text(OLD_SHAPE)
    fixed, failed = gen.ensure_main_landmarks(tmp_path)
    assert (fixed, failed) == (1, [])
    assert _main_ok(page.read_text())
