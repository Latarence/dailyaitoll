"""Integration tests for the full toll collection flow."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from run_toll import (
    parse_response, validate_event, filter_events,
    build_prompt, load_rollup, update_data
)


def test_build_prompt():
    """Test that build_prompt generates a valid prompt."""
    prompt = build_prompt()
    assert "Daily AI Toll Collection" in prompt
    assert "collected_date" in prompt
    assert "ONLY a JSON object" in prompt


def test_full_flow_with_mock_response():
    """Test the full parsing and filtering flow with a realistic LLM response."""
    mock_response = '''Based on my search, I found the following events:

{
  "collected_date": "2026-04-30",
  "events": [
    {
      "id": "evt_20260430_001",
      "event_date": "2026-04-30",
      "headline": "Tech Corp lays off 150 customer service reps, cites AI chatbots",
      "source_url": "https://example.com/news/123",
      "source_name": "TechNews",
      "excerpt": "Tech Corp announced today that it would eliminate 150 positions...",
      "causality": "direct",
      "confidence": 0.85,
      "tolls": {"jobs": 150, "teams": 2, "companies": 1, "labor_hours": -312000}
    },
    {
      "id": "evt_20260430_002",
      "event_date": "2026-04-30",
      "headline": "Low confidence rumor about layoffs",
      "source_url": "https://example.com/blog/456",
      "source_name": "RandomBlog",
      "confidence": 0.3,
      "tolls": {"jobs": 50}
    },
    {
      "id": "evt_20260430_003",
      "event_date": "2026-04-30",
      "headline": "Zero jobs event",
      "source_url": "https://example.com/news/789",
      "source_name": "News",
      "confidence": 0.9,
      "tolls": {"jobs": 0}
    }
  ],
  "summary": "Found 3 events today"
}

Let me know if you need more details.'''

    # Parse response
    result = parse_response(mock_response)
    assert result["collected_date"] == "2026-04-30"
    assert len(result["events"]) == 3

    # Filter events
    valid, rejected = filter_events(result["events"])

    # Should keep only the high-confidence event with jobs > 0
    assert len(valid) == 1
    assert len(rejected) == 2
    assert valid[0]["headline"] == "Tech Corp lays off 150 customer service reps, cites AI chatbots"

    # Check rejection reasons
    reasons = [r["reason"] for r in rejected]
    assert any("confidence" in r for r in reasons)
    assert any("jobs" in r for r in reasons)


def test_update_data_adds_jobs():
    """Test that update_data correctly updates totals."""
    result = {
        "collected_date": "2026-04-30",
        "events": [{
            "id": "evt_test_001",
            "headline": "Test event",
            "source_url": "https://test.com",
            "confidence": 0.9,
            "tolls": {"jobs": 100, "teams": 1, "companies": 1, "labor_hours": -208000}
        }],
        "summary": "Test"
    }

    # Create a fresh rollup for testing
    rollup = {
        "last_updated": None,
        "totals": {"jobs": 0, "teams": 0, "products": 0, "companies": 0, "revenue": 0, "labor_hours": 0},
        "today": {"jobs": 0, "teams": 0, "products": 0, "companies": 0, "revenue": 0, "labor_hours": 0},
        "daily_totals": {},
        "events_count": 0,
        "pending_review": 0,
        "summary": "",
        "events": [],
        "all_events": []
    }

    rollup = update_data(result, rollup)

    assert rollup["today"]["jobs"] == 100
    assert rollup["totals"]["jobs"] == 100
    assert rollup["events_count"] == 1


def test_no_events_response():
    """Test handling of response with no events."""
    mock_response = '{"collected_date": "2026-04-30", "events": [], "summary": "No new events found."}'

    result = parse_response(mock_response)
    assert result["events"] == []

    valid, rejected = filter_events(result["events"])
    assert len(valid) == 0
    assert len(rejected) == 0


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
