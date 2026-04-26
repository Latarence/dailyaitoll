#!/usr/bin/env python3
"""
Daily AI Toll - Collection Script

Prompts Claude to search for and report AI displacement events.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Paths
ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
REPORTS_DIR = ROOT / "reports" / "daily"
EVENTS_FILE = DATA_DIR / "events.jsonl"
PENDING_FILE = DATA_DIR / "pending.jsonl"
ROLLUP_FILE = DATA_DIR / "daily_rollup.json"
WEB_DATA_DIR = ROOT / "web" / "data"

# Ensure directories exist
DATA_DIR.mkdir(exist_ok=True)
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)


def get_today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def load_rollup() -> dict:
    if ROLLUP_FILE.exists():
        with open(ROLLUP_FILE, "r") as f:
            return json.load(f)
    return {
        "last_updated": None,
        "totals": {"jobs": 0, "teams": 0, "products": 0, "companies": 0, "revenue": 0, "labor_hours": 0},
        "today": {"jobs": 0, "teams": 0, "products": 0, "companies": 0, "revenue": 0, "labor_hours": 0},
        "events_count": 0,
        "pending_review": 0
    }


def build_prompt() -> str:
    today = get_today()
    rollup = load_rollup()

    return f"""# Daily AI Toll Collection — {today}

Search for verifiable instances of AI displacing human workers from the past 24-48 hours.

## What to find
- Layoffs explicitly citing AI/automation as a cause
- Companies replacing workers with AI tools (customer service, coding, writing, etc.)
- Teams reduced after AI tool deployment
- Products discontinued due to AI alternatives

## What to exclude
- Future projections ("AI may eliminate X jobs by 2030")
- AI hiring/capability announcements without actual job displacement
- Opinion pieces without concrete events
- Events already in our database

## Current totals (for context)
- Jobs displaced: {rollup['totals']['jobs']:,}
- Companies affected: {rollup['totals']['companies']:,}
- Events tracked: {rollup['events_count']}

## Output format

Return a JSON object with this structure:

```json
{{
  "date": "{today}",
  "events": [
    {{
      "id": "evt_{today.replace('-', '')}_001",
      "headline": "Company X lays off 200 support staff, cites AI",
      "source_url": "https://...",
      "source_name": "Reuters",
      "excerpt": "Direct quote from article...",
      "causality": "direct",
      "confidence": 0.85,
      "tolls": {{
        "jobs": 200,
        "teams": 3,
        "companies": 1,
        "labor_hours": -416000
      }},
      "notes": "Q2 restructuring"
    }}
  ],
  "summary": "Brief summary of today's findings"
}}
```

### Field definitions
- **causality**: "direct" (AI explicitly cited), "contributing" (AI among factors), "inferred" (pattern suggests AI)
- **confidence**: 0.0-1.0 based on source reliability
- **labor_hours**: negative = hours eliminated (jobs × 2080 annual hours)

If no events found, return:
```json
{{"date": "{today}", "events": [], "summary": "No verifiable AI displacement events found in the past 24 hours."}}
```

Search now and return the JSON."""


def call_claude(prompt: str) -> str:
    """Call Anthropic API."""
    try:
        import anthropic
    except ImportError:
        import subprocess
        subprocess.run([sys.executable, "-m", "pip", "install", "anthropic"], check=True)
        import anthropic

    client = anthropic.Anthropic()

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )

    return message.content[0].text


def parse_response(response: str) -> dict:
    """Extract JSON from Claude's response."""
    # Try to find JSON block
    if "```json" in response:
        start = response.find("```json") + 7
        end = response.find("```", start)
        response = response[start:end]
    elif "```" in response:
        start = response.find("```") + 3
        end = response.find("```", start)
        response = response[start:end]

    return json.loads(response.strip())


def update_data(result: dict, rollup: dict) -> dict:
    """Update rollup with new events."""
    today = get_today()
    events = result.get("events", [])

    # Reset today
    rollup["today"] = {"jobs": 0, "teams": 0, "products": 0, "companies": 0, "revenue": 0, "labor_hours": 0}

    for event in events:
        tolls = event.get("tolls", {})
        for key in rollup["today"]:
            val = tolls.get(key) or 0
            rollup["today"][key] += val
            rollup["totals"][key] += val

    rollup["last_updated"] = datetime.now(timezone.utc).isoformat()
    rollup["events_count"] += len(events)

    return rollup


def save_outputs(result: dict, rollup: dict) -> None:
    """Save all output files."""
    today = get_today()
    events = result.get("events", [])

    # Append events to JSONL
    if events:
        with open(EVENTS_FILE, "a") as f:
            for event in events:
                event["date"] = today
                event["created_at"] = datetime.now(timezone.utc).isoformat()
                f.write(json.dumps(event) + "\n")

    # Save rollup
    with open(ROLLUP_FILE, "w") as f:
        json.dump(rollup, f, indent=2)

    # Copy to web
    with open(WEB_DATA_DIR / "daily_rollup.json", "w") as f:
        json.dump(rollup, f, indent=2)

    # Generate report
    report = f"""# Daily AI Toll — {today}

## Summary

{result.get('summary', 'No summary available.')}

## Today's Impact

| Metric | Today | Total |
|--------|-------|-------|
| Jobs | {rollup['today']['jobs']:,} | {rollup['totals']['jobs']:,} |
| Teams | {rollup['today']['teams']:,} | {rollup['totals']['teams']:,} |
| Companies | {rollup['today']['companies']:,} | {rollup['totals']['companies']:,} |
| Labor Hours | {rollup['today']['labor_hours']:,} | {rollup['totals']['labor_hours']:,} |

## Events

"""

    if not events:
        report += "_No events recorded._\n"
    else:
        for event in events:
            report += f"""### {event.get('headline', 'Untitled')}

**Source:** [{event.get('source_name')}]({event.get('source_url')})
**Causality:** {event.get('causality')} | **Confidence:** {event.get('confidence', 0):.0%}

> {event.get('excerpt', '')}

**Impact:** {event.get('tolls', {}).get('jobs', 0):,} jobs

---

"""

    report += f"\n*Generated: {datetime.now(timezone.utc).isoformat()}*\n"

    with open(REPORTS_DIR / f"{today}.md", "w") as f:
        f.write(report)


def main() -> int:
    today = get_today()
    print(f"[{today}] Daily AI Toll collection starting...")

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY not set")
        return 1

    # Build prompt and call Claude
    prompt = build_prompt()
    print("Calling Claude...")

    response = call_claude(prompt)
    print(f"Response received ({len(response)} chars)")

    # Parse response
    try:
        result = parse_response(response)
    except json.JSONDecodeError as e:
        print(f"Failed to parse response: {e}")
        print(f"Raw response:\n{response}")
        return 1

    events = result.get("events", [])
    print(f"Found {len(events)} events")

    # Update data
    rollup = load_rollup()
    rollup = update_data(result, rollup)

    # Save outputs
    save_outputs(result, rollup)

    print(f"Summary: {result.get('summary', 'N/A')}")
    print(f"[{today}] Complete. Jobs today: {rollup['today']['jobs']}, Total: {rollup['totals']['jobs']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
