"""labor_hours is a count of hours eliminated and must be stored positive.

Regression: the collector prompt and the historical importer used a negative
sign to mean "eliminated", so daily_rollup.json carried values such as
totals.labor_hours = -604293920 while the site rendered Math.abs() of it.
"""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import run_toll  # noqa: E402
from run_toll import build_prompt, normalize_rollup_signs, update_data  # noqa: E402

ZERO = {"jobs": 0, "teams": 0, "products": 0, "companies": 0, "revenue": 0, "labor_hours": 0}


def _fresh_rollup():
    return {
        "last_updated": None,
        "totals": dict(ZERO),
        "today": dict(ZERO),
        "daily_totals": {},
        "events_count": 0,
        "pending_review": 0,
        "summary": "",
        "events": [],
        "all_events": [],
    }


@pytest.fixture
def isolated_events(tmp_path, monkeypatch):
    monkeypatch.setattr(run_toll, "EVENTS_FILE", tmp_path / "events.jsonl")
    return tmp_path


def _event(n, jobs, labor_hours):
    return {
        "event_date": "2026-10-13",
        "headline": f"Sign test company {n} cuts {jobs} roles citing AI",
        "source_url": f"https://example.com/sign-test/{n}",
        "confidence": 0.9,
        "tolls": {"jobs": jobs, "teams": 0, "companies": 1, "labor_hours": labor_hours},
    }


def test_update_data_stores_positive_labor_hours(isolated_events):
    # Legacy negative (old prompt convention) and the new positive convention
    # must both aggregate to a positive total.
    result = {
        "collected_date": "2026-10-13",
        "events": [_event(1, 100, -208000), _event(2, 50, 104000)],
        "summary": "t",
    }
    rollup = update_data(result, _fresh_rollup())

    assert rollup["today"]["labor_hours"] == 312000
    assert rollup["totals"]["labor_hours"] == 312000
    assert rollup["daily_totals"]["2026-10-13"]["labor_hours"] == 312000
    for ev in rollup["events"] + rollup["all_events"]:
        assert ev["tolls"]["labor_hours"] > 0


def test_load_rollup_migrates_negative_values(tmp_path, monkeypatch):
    legacy = _fresh_rollup()
    legacy["totals"]["labor_hours"] = -604293920
    legacy["today"]["labor_hours"] = -6801600
    legacy["daily_totals"] = {"2026-05-05": dict(ZERO, jobs=5960, labor_hours=-12396800)}
    legacy["all_events"] = [{"tolls": {"jobs": 10, "labor_hours": -20800}}]
    legacy["events"] = [{"tolls": {"jobs": 10, "labor_hours": -20800}}]
    path = tmp_path / "daily_rollup.json"
    path.write_text(json.dumps(legacy))
    monkeypatch.setattr(run_toll, "ROLLUP_FILE", path)

    data = run_toll.load_rollup()

    assert data["totals"]["labor_hours"] == 604293920
    assert data["today"]["labor_hours"] == 6801600
    assert data["daily_totals"]["2026-05-05"]["labor_hours"] == 12396800
    assert data["all_events"][0]["tolls"]["labor_hours"] == 20800
    assert data["events"][0]["tolls"]["labor_hours"] == 20800


def test_normalize_tolerates_missing_and_null_values():
    data = {"totals": {"labor_hours": None}, "today": {}, "all_events": [{"tolls": None}, {}]}
    normalize_rollup_signs(data)  # must not raise
    assert data["totals"]["labor_hours"] is None


def test_prompt_asks_for_positive_labor_hours():
    prompt = build_prompt()
    assert '"labor_hours": -' not in prompt
    assert "negative = hours eliminated" not in prompt


def _walk_negatives(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk_negatives(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk_negatives(v, f"{path}[{i}]")
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool) and obj < 0:
        yield path, obj


@pytest.mark.parametrize("rel", ["data/daily_rollup.json", "web/data/daily_rollup.json"])
def test_committed_rollup_has_no_negative_counts(rel):
    path = ROOT / rel
    if not path.exists():
        pytest.skip(f"{rel} not present")
    data = json.loads(path.read_text())
    bad = list(_walk_negatives(data))
    assert not bad, f"negative values in {rel}: {bad[:5]}"


def test_committed_events_have_positive_labor_hours():
    path = ROOT / "data" / "events.jsonl"
    if not path.exists():
        pytest.skip("events.jsonl not present")
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        lh = (json.loads(line).get("tolls") or {}).get("labor_hours")
        assert lh is None or lh >= 0
