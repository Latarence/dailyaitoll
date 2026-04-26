#!/usr/bin/env python3
"""
Daily AI Toll - Collection Script

Invokes Claude Code CLI to process sources and update toll data.
Outputs: data/events.jsonl, data/daily_rollup.json, reports/daily/YYYY-MM-DD.md
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Paths
ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
REPORTS_DIR = ROOT / "reports" / "daily"
CONFIG_DIR = ROOT / "config"
EVENTS_FILE = DATA_DIR / "events.jsonl"
PENDING_FILE = DATA_DIR / "pending.jsonl"
ROLLUP_FILE = DATA_DIR / "daily_rollup.json"

# Ensure directories exist
DATA_DIR.mkdir(exist_ok=True)
REPORTS_DIR.mkdir(parents=True, exist_ok=True)


def get_today() -> str:
    """Get today's date in YYYY-MM-DD format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def load_existing_events() -> list[dict]:
    """Load existing events from JSONL file."""
    events = []
    if EVENTS_FILE.exists():
        with open(EVENTS_FILE, "r") as f:
            for line in f:
                if line.strip():
                    events.append(json.loads(line))
    return events


def load_rollup() -> dict:
    """Load existing rollup or create default."""
    if ROLLUP_FILE.exists():
        with open(ROLLUP_FILE, "r") as f:
            return json.load(f)
    return {
        "last_updated": None,
        "totals": {
            "jobs": 0,
            "teams": 0,
            "products": 0,
            "companies": 0,
            "revenue": 0,
            "labor_hours": 0
        },
        "today": {
            "jobs": 0,
            "teams": 0,
            "products": 0,
            "companies": 0,
            "revenue": 0,
            "labor_hours": 0
        },
        "events_count": 0,
        "pending_review": 0
    }


def build_prompt() -> str:
    """Build the prompt for Claude Code CLI."""
    today = get_today()

    return f"""You are the Daily AI Toll collector. Today is {today}.

Your task: Search for and document verifiable instances of AI displacing human workers.

## Rules
1. NO EVIDENCE, NO ENTRY - Every event must have a source URL
2. Required fields: source_url, source_name, excerpt, causality, confidence, tolls
3. Only include events from the last 24-48 hours
4. Causality must be: direct, contributing, or inferred
5. Confidence score: 0.0-1.0 based on source reliability and specificity

## Search Strategy
1. Check major tech news: Reuters, Bloomberg, TechCrunch, The Verge
2. Search: "AI layoffs today", "AI job cuts", "company replaces workers AI"
3. Check layoffs.fyi for recent entries mentioning AI
4. Verify claims with primary sources when possible

## Output Format
For each event found, output a JSON object (one per line):

```json
{{"id": "evt_{today}_001", "date": "{today}", "source_url": "https://...", "source_name": "Source", "excerpt": "Quote from article...", "causality": "direct|contributing|inferred", "confidence": 0.85, "status": "verified|pending", "tolls": {{"jobs": 100, "teams": 2, "products": 0, "companies": 1, "revenue": null, "labor_hours": -208000}}, "notes": "Additional context"}}
```

## What to Look For
- Layoff announcements citing AI/automation
- Companies replacing customer service with chatbots
- Coding/writing teams reduced after AI tool adoption
- Products discontinued due to AI alternatives

## What to Exclude
- Future projections ("AI may eliminate X jobs by 2030")
- Hiring freezes without layoffs
- AI tool announcements without workforce impact
- Opinion pieces without factual events

Search now and output all events found. If no events found today, output: {{"no_events": true, "date": "{today}"}}
"""


def run_claude_code(prompt: str) -> str:
    """Invoke Claude Code CLI with the given prompt."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    # Try Claude Code CLI first
    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "text"],
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
            env={**os.environ, "ANTHROPIC_API_KEY": api_key}
        )
        if result.returncode == 0:
            return result.stdout
        else:
            print(f"Claude CLI error: {result.stderr}")
    except FileNotFoundError:
        print("Claude CLI not found, falling back to API...")
    except subprocess.TimeoutExpired:
        print("Claude CLI timed out")

    # Fallback: Direct API call
    return call_anthropic_api(prompt)


def call_anthropic_api(prompt: str) -> str:
    """Direct API call to Anthropic as fallback."""
    try:
        import anthropic
    except ImportError:
        print("Installing anthropic package...")
        subprocess.run([sys.executable, "-m", "pip", "install", "anthropic"], check=True)
        import anthropic

    client = anthropic.Anthropic()

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[
            {"role": "user", "content": prompt}
        ]
    )

    return message.content[0].text


def parse_events(output: str) -> list[dict]:
    """Parse Claude's output into event objects."""
    events = []

    for line in output.split("\n"):
        line = line.strip()
        if not line or line.startswith("```"):
            continue

        # Try to parse as JSON
        if line.startswith("{"):
            try:
                event = json.loads(line)
                if "no_events" in event:
                    print(f"No events found for {event.get('date', 'today')}")
                    continue
                if "source_url" in event:
                    events.append(event)
            except json.JSONDecodeError:
                continue

    return events


def update_rollup(events: list[dict], rollup: dict) -> dict:
    """Update rollup totals with new events."""
    today = get_today()

    # Reset today's counts
    rollup["today"] = {
        "jobs": 0,
        "teams": 0,
        "products": 0,
        "companies": 0,
        "revenue": 0,
        "labor_hours": 0
    }

    for event in events:
        if event.get("date") == today and event.get("status") == "verified":
            tolls = event.get("tolls", {})
            for key in rollup["today"]:
                value = tolls.get(key) or 0
                rollup["today"][key] += value
                rollup["totals"][key] += value

    rollup["last_updated"] = datetime.now(timezone.utc).isoformat()
    rollup["events_count"] = len(load_existing_events()) + len([e for e in events if e.get("status") == "verified"])
    rollup["pending_review"] = len([e for e in events if e.get("status") == "pending"])

    return rollup


def generate_report(events: list[dict], rollup: dict) -> str:
    """Generate daily markdown report."""
    today = get_today()

    report = f"""# Daily AI Toll Report — {today}

## Summary

| Metric | Today | Cumulative |
|--------|-------|------------|
| Jobs | {rollup['today']['jobs']:,} | {rollup['totals']['jobs']:,} |
| Teams | {rollup['today']['teams']:,} | {rollup['totals']['teams']:,} |
| Products | {rollup['today']['products']:,} | {rollup['totals']['products']:,} |
| Companies | {rollup['today']['companies']:,} | {rollup['totals']['companies']:,} |
| Revenue | ${rollup['today']['revenue']:,} | ${rollup['totals']['revenue']:,} |
| Labor Hours | {rollup['today']['labor_hours']:,} | {rollup['totals']['labor_hours']:,} |

## Events

"""

    today_events = [e for e in events if e.get("date") == today]

    if not today_events:
        report += "_No new events recorded today._\n"
    else:
        for event in today_events:
            report += f"""### {event.get('source_name', 'Unknown Source')}

- **Source:** [{event.get('source_url', '#')}]({event.get('source_url', '#')})
- **Causality:** {event.get('causality', 'unknown')}
- **Confidence:** {event.get('confidence', 0):.0%}
- **Status:** {event.get('status', 'unknown')}

> {event.get('excerpt', 'No excerpt available.')}

**Impact:**
- Jobs: {event.get('tolls', {}).get('jobs', 0):,}
- Teams: {event.get('tolls', {}).get('teams', 0):,}
- Labor Hours: {event.get('tolls', {}).get('labor_hours', 0):,}

---

"""

    report += f"""
## Methodology

Events are collected via automated search and verified by human review.
See [methodology.md](/docs/methodology.md) for details.

---

*Generated: {datetime.now(timezone.utc).isoformat()}*
"""

    return report


def save_events(events: list[dict]) -> None:
    """Append new events to JSONL file."""
    verified = [e for e in events if e.get("status") == "verified"]
    pending = [e for e in events if e.get("status") == "pending"]

    if verified:
        with open(EVENTS_FILE, "a") as f:
            for event in verified:
                f.write(json.dumps(event) + "\n")

    if pending:
        with open(PENDING_FILE, "a") as f:
            for event in pending:
                f.write(json.dumps(event) + "\n")


def main() -> int:
    """Run the daily toll collection."""
    today = get_today()
    print(f"[{today}] Starting Daily AI Toll collection...")

    # Check for full scan mode
    full_scan = os.environ.get("FULL_SCAN", "false").lower() == "true"
    if full_scan:
        print("Running full historical scan...")

    # Build and run prompt
    prompt = build_prompt()
    print("Invoking Claude...")

    output = run_claude_code(prompt)
    print(f"Received {len(output)} characters of output")

    # Parse events
    events = parse_events(output)
    print(f"Parsed {len(events)} events")

    if events:
        # Save events
        save_events(events)
        print(f"Saved events to {EVENTS_FILE}")

        # Update rollup
        rollup = load_rollup()
        rollup = update_rollup(events, rollup)
        with open(ROLLUP_FILE, "w") as f:
            json.dump(rollup, f, indent=2)
        print(f"Updated rollup: {ROLLUP_FILE}")

        # Generate report
        report = generate_report(events, rollup)
        report_file = REPORTS_DIR / f"{today}.md"
        with open(report_file, "w") as f:
            f.write(report)
        print(f"Generated report: {report_file}")

        # Copy rollup to web for dashboard
        web_data = ROOT / "web" / "data"
        web_data.mkdir(exist_ok=True)
        with open(web_data / "daily_rollup.json", "w") as f:
            json.dump(rollup, f, indent=2)
        print("Updated web dashboard data")
    else:
        print("No events found today")

    print(f"[{today}] Collection complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
