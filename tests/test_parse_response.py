"""Tests for run_toll.py parse_response function."""

import json
import sys
from pathlib import Path

# Add scripts to path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from run_toll import parse_response


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


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
