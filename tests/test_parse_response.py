"""Tests for run_toll.py parsing and validation functions."""

import json
import sys
from pathlib import Path

# Add scripts to path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from run_toll import parse_response, validate_event, filter_events


def test_parse_pure_json():
    """Test parsing a pure JSON response."""
    response = '{"collected_date": "2026-04-28", "events": [], "summary": "No events"}'
    result = parse_response(response)
    assert result["collected_date"] == "2026-04-28"
    assert result["events"] == []


def test_parse_json_with_preamble():
    """Test parsing JSON with explanatory text before it."""
    response = """Based on my searches of recent AI-related job displacement events from the past 24-48 hours, I found that the information available primarily covers events that are already included in the "Already tracked" list.

Here is the requested JSON response:

{"collected_date": "2026-04-28", "events": [], "summary": "No new verifiable AI displacement events found."}"""

    result = parse_response(response)
    assert result["collected_date"] == "2026-04-28"
    assert result["events"] == []
    assert "No new verifiable" in result["summary"]


def test_parse_json_with_markdown_code_block():
    """Test parsing JSON wrapped in markdown code block."""
    response = """Here are the results:

```json
{"collected_date": "2026-04-28", "events": [], "summary": "No events found."}
```

That's all I found."""

    result = parse_response(response)
    assert result["collected_date"] == "2026-04-28"


def test_parse_json_with_generic_code_block():
    """Test parsing JSON wrapped in generic markdown code block."""
    response = """```
{"collected_date": "2026-04-28", "events": []}
```"""

    result = parse_response(response)
    assert result["collected_date"] == "2026-04-28"


def test_parse_json_with_trailing_text():
    """Test parsing JSON with text after it."""
    response = """{"collected_date": "2026-04-28", "events": [], "summary": "Done"}

Let me know if you need more information."""

    result = parse_response(response)
    assert result["collected_date"] == "2026-04-28"


def test_parse_json_with_events():
    """Test parsing a response with actual events."""
    response = """{
  "collected_date": "2026-04-28",
  "events": [
    {
      "id": "evt_20260428_001",
      "headline": "Company X lays off 50 support staff",
      "tolls": {"jobs": 50, "teams": 2}
    }
  ],
  "summary": "One event found"
}"""

    result = parse_response(response)
    assert result["collected_date"] == "2026-04-28"
    assert len(result["events"]) == 1
    assert result["events"][0]["tolls"]["jobs"] == 50


def test_parse_whitespace_handling():
    """Test that whitespace is handled correctly."""
    response = """

   {"collected_date": "2026-04-28", "events": []}

"""
    result = parse_response(response)
    assert result["collected_date"] == "2026-04-28"


## Validation tests

def test_validate_event_valid():
    """Test a valid event passes validation."""
    event = {
        "headline": "Company X lays off 100 workers",
        "source_url": "https://example.com/news",
        "confidence": 0.85,
        "tolls": {"jobs": 100}
    }
    is_valid, reason = validate_event(event)
    assert is_valid
    assert reason == "ok"


def test_validate_event_low_confidence():
    """Test that low confidence events are rejected."""
    event = {
        "headline": "Company X lays off 100 workers",
        "source_url": "https://example.com/news",
        "confidence": 0.3,  # Below MIN_CONFIDENCE (0.5)
        "tolls": {"jobs": 100}
    }
    is_valid, reason = validate_event(event)
    assert not is_valid
    assert "confidence" in reason


def test_validate_event_zero_jobs():
    """Test that zero-job events are rejected."""
    event = {
        "headline": "Company announces AI strategy",
        "source_url": "https://example.com/news",
        "confidence": 0.9,
        "tolls": {"jobs": 0}
    }
    is_valid, reason = validate_event(event)
    assert not is_valid
    assert "jobs" in reason


def test_validate_event_excessive_jobs():
    """Test that unreasonably high job counts are rejected."""
    event = {
        "headline": "Entire industry eliminated",
        "source_url": "https://example.com/news",
        "confidence": 0.9,
        "tolls": {"jobs": 500000}  # Above MAX_JOBS_PER_EVENT (100000)
    }
    is_valid, reason = validate_event(event)
    assert not is_valid
    assert "sanity check" in reason


def test_validate_event_missing_headline():
    """Test that events without headlines are rejected."""
    event = {
        "source_url": "https://example.com/news",
        "confidence": 0.9,
        "tolls": {"jobs": 100}
    }
    is_valid, reason = validate_event(event)
    assert not is_valid
    assert "headline" in reason


def test_validate_event_missing_source():
    """Test that events without source URLs are rejected."""
    event = {
        "headline": "Company X lays off workers",
        "confidence": 0.9,
        "tolls": {"jobs": 100}
    }
    is_valid, reason = validate_event(event)
    assert not is_valid
    assert "source_url" in reason


def test_filter_events_mixed():
    """Test filtering a mix of valid and invalid events."""
    events = [
        {"headline": "Valid event", "source_url": "https://a.com", "confidence": 0.9, "tolls": {"jobs": 50}},
        {"headline": "Low confidence", "source_url": "https://b.com", "confidence": 0.2, "tolls": {"jobs": 50}},
        {"headline": "No jobs", "source_url": "https://c.com", "confidence": 0.9, "tolls": {"jobs": 0}},
    ]
    valid, rejected = filter_events(events)
    assert len(valid) == 1
    assert len(rejected) == 2
    assert valid[0]["headline"] == "Valid event"


def test_filter_events_max_cap():
    """Test that events are capped at MAX_EVENTS_PER_DAY."""
    # Create 15 valid events (exceeds MAX_EVENTS_PER_DAY of 10)
    events = [
        {"headline": f"Event {i}", "source_url": f"https://{i}.com", "confidence": 0.5 + (i * 0.03), "tolls": {"jobs": 10}}
        for i in range(15)
    ]
    valid, rejected = filter_events(events)
    assert len(valid) == 10
    assert len(rejected) == 5
    # Should keep highest confidence events
    assert all(e["confidence"] >= 0.65 for e in valid)


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
