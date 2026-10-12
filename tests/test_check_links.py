"""Tests for scripts/check_links.py and the generator's dead-source handling (C7-006)."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))


def _load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_classify():
    cl = _load("check_links")
    assert cl.classify("200") == "ok"
    assert cl.classify("404") == "dead"
    assert cl.classify("410") == "dead"
    assert cl.classify("403") == "blocked"
    assert cl.classify("error:TimeoutError") == "error"


def test_share_links_are_not_citations():
    cl = _load("check_links")
    assert not cl.is_citation("https://twitter.com/intent/tweet?text=x")
    assert not cl.is_citation("https://www.linkedin.com/shareArticle?mini=true&url=x")
    assert cl.is_citation("https://techcrunch.com/2026/01/01/story/")


def test_generator_marks_unavailable_and_archived_sources():
    gen = _load("generate_daily_pages")
    gone = gen.generate_event_html({"headline": "Acme cuts", "source_url": None, "source_unavailable": True}, 0)
    assert "(link no longer available)" in gone and "<a href" not in gone
    arch = gen.generate_event_html({"headline": "Acme cuts", "source_url": "https://web.archive.org/web/2024/https://x.com/a", "source_archived": True}, 0)
    assert "source (archived)" in arch and "web.archive.org" in arch
