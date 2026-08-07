"""Tests for fingerprint-based event dedup (is_duplicate_event)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from run_toll import _company_key, is_duplicate_event


RECORDS = [
    {"company": "meta", "jobs": 8000, "event_date": "2026-04-26",
     "url": "https://example.com/meta-8000-layoffs"},
    {"company": "visa", "jobs": 2600, "event_date": "2026-07-28",
     "url": "https://www.cnbc.com/2026/07/28/visa-cuts"},
]


def test_company_key_strips_punctuation():
    assert _company_key("Monday.com lays off 20%") == "monday.com".strip(".")
    assert _company_key("Visa cuts 2,600 jobs") == "visa"
    assert _company_key("") == ""


def test_same_url_is_duplicate():
    event = {"headline": "Totally different headline",
             "source_url": "https://www.cnbc.com/2026/07/28/visa-cuts/",
             "tolls": {"jobs": 9999}, "event_date": "2026-08-06"}
    assert is_duplicate_event(event, RECORDS) is not None


def test_same_company_jobs_within_window_is_duplicate():
    # Re-report weeks later with a fresh URL and reworded headline
    event = {"headline": "Meta lays off 8,000 employees, shifts to AI",
             "source_url": "https://other-outlet.com/meta-story",
             "tolls": {"jobs": 8000}, "event_date": "2026-05-25"}
    assert is_duplicate_event(event, RECORDS) is not None


def test_same_company_jobs_outside_window_is_new():
    # Same company + count 6 months later = plausibly a new round
    event = {"headline": "Meta cuts 8,000 more jobs",
             "source_url": "https://other-outlet.com/meta-round-two",
             "tolls": {"jobs": 8000}, "event_date": "2026-11-15"}
    assert is_duplicate_event(event, RECORDS) is None


def test_same_company_different_jobs_is_new():
    event = {"headline": "Meta trims 500 contractor roles",
             "source_url": "https://other-outlet.com/meta-contractors",
             "tolls": {"jobs": 500}, "event_date": "2026-04-30"}
    assert is_duplicate_event(event, RECORDS) is None


def test_missing_fields_do_not_crash():
    assert is_duplicate_event({}, RECORDS) is None
    assert is_duplicate_event({"headline": "X", "tolls": {}}, []) is None
