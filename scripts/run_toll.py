#!/usr/bin/env python3
"""
Daily AI Toll - Collection Script

Prompts LLM to search for and report AI displacement events.
Supports: Anthropic (Claude) and OpenAI (GPT-4) with automatic fallback.
"""

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# =============================================================================
# CONFIGURATION - Token usage and quality thresholds
# =============================================================================

# Token limits (cost protection)
MAX_TOKENS_RESPONSE = 4096          # Max tokens in LLM response (was 8096)
MAX_RESPONSE_CHARS = 50000          # Max response length before warning
MAX_EVENTS_PER_DAY = 10             # Cap events to prevent runaway costs

# Quality thresholds
MIN_CONFIDENCE = 0.5                # Minimum confidence score (0.0-1.0)
MIN_JOBS_PER_EVENT = 1              # Minimum jobs to include event
MAX_JOBS_PER_EVENT = 100000         # Sanity check - reject if above this

# Retry settings
MAX_RETRIES = 2                     # Retries per provider before fallback
RETRY_DELAY_SECONDS = 5             # Delay between retries

# Model configuration (update these when models change)
ANTHROPIC_MODEL = "claude-sonnet-4-20250514"
ANTHROPIC_SEARCH_TOOL = "web_search_20250115"
OPENAI_MODEL = "gpt-4o"

# =============================================================================
# Paths
# =============================================================================

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
REPORTS_DIR = ROOT / "reports" / "daily"
EVENTS_FILE = DATA_DIR / "events.jsonl"
ROLLUP_FILE = DATA_DIR / "daily_rollup.json"
WEB_DATA_DIR = ROOT / "web" / "data"
USAGE_FILE = DATA_DIR / "token_usage.jsonl"

# Ensure directories exist
DATA_DIR.mkdir(exist_ok=True)
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)


def get_today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def load_rollup() -> dict:
    if ROLLUP_FILE.exists():
        with open(ROLLUP_FILE, "r") as f:
            data = json.load(f)
            # Migrate old format if needed
            if "daily_totals" not in data:
                data["daily_totals"] = {}
            if "all_events" not in data:
                data["all_events"] = data.get("events", [])
            return data
    return {
        "last_updated": None,
        "totals": {"jobs": 0, "teams": 0, "products": 0, "companies": 0, "revenue": 0, "labor_hours": 0},
        "today": {"jobs": 0, "teams": 0, "products": 0, "companies": 0, "revenue": 0, "labor_hours": 0},
        "daily_totals": {},  # Keyed by event_date: {"jobs": N, "teams": N, ...}
        "events_count": 0,
        "pending_review": 0,
        "summary": "",
        "events": [],      # Today's new events
        "all_events": []   # All events for display
    }


def load_known_event_ids() -> set:
    """Load existing event IDs to prevent duplicates."""
    known_ids = set()
    if EVENTS_FILE.exists():
        with open(EVENTS_FILE, "r") as f:
            for line in f:
                if line.strip():
                    try:
                        event = json.loads(line)
                        known_ids.add(event.get("id", ""))
                        # Also track by headline to catch duplicates with different IDs
                        known_ids.add(event.get("headline", "").lower().strip())
                    except json.JSONDecodeError:
                        pass
    return known_ids


def build_prompt() -> str:
    today = get_today()
    rollup = load_rollup()
    known_ids = load_known_event_ids()

    # Get recent headlines to help LLM avoid duplicates
    recent_headlines = []
    if EVENTS_FILE.exists():
        with open(EVENTS_FILE, "r") as f:
            for line in f:
                if line.strip():
                    try:
                        event = json.loads(line)
                        recent_headlines.append(event.get("headline", ""))
                    except json.JSONDecodeError:
                        pass
    recent_headlines = recent_headlines[-20:]  # Last 20 events

    recent_list = "\n".join(f"- {h}" for h in recent_headlines) if recent_headlines else "None yet"

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
- Events we've already tracked (see below)

## Already tracked (DO NOT duplicate)
{recent_list}

## Current totals (for context)
- Jobs displaced: {rollup['totals']['jobs']:,}
- Companies affected: {rollup['totals']['companies']:,}
- Events tracked: {rollup['events_count']}

## Output format

Return ONLY a JSON object (no other text):

{{
  "collected_date": "{today}",
  "events": [
    {{
      "id": "evt_YYYYMMDD_NNN",
      "event_date": "YYYY-MM-DD",
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

### Field definitions
- id: Use format evt_YYYYMMDD_NNN where YYYYMMDD is the EVENT date (when it happened), not today
- event_date: The actual date the event occurred/was announced (YYYY-MM-DD format)
- causality: "direct" (AI explicitly cited), "contributing" (AI among factors), "inferred" (pattern suggests AI)
- confidence: 0.0-1.0 based on source reliability
- labor_hours: negative = hours eliminated (jobs × 2080 annual hours)

If no NEW events found:
{{"collected_date": "{today}", "events": [], "summary": "No new verifiable AI displacement events found."}}

Search now and return JSON only."""


def call_anthropic(prompt: str) -> tuple[str, dict]:
    """Call Anthropic Claude API with web search enabled.

    Returns: (response_text, usage_info)
    """
    try:
        import anthropic
    except ImportError:
        import subprocess
        subprocess.run([sys.executable, "-m", "pip", "install", "anthropic"], check=True)
        import anthropic

    client = anthropic.Anthropic()
    message = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=MAX_TOKENS_RESPONSE,
        tools=[{
            "type": ANTHROPIC_SEARCH_TOOL,
            "name": "web_search",
        }],
        messages=[{"role": "user", "content": prompt}]
    )

    # Extract text from response (may include tool use blocks)
    result = ""
    for block in message.content:
        if hasattr(block, "text"):
            result += block.text

    # Track token usage
    usage = {
        "provider": "anthropic",
        "model": ANTHROPIC_MODEL,
        "input_tokens": getattr(message.usage, "input_tokens", 0),
        "output_tokens": getattr(message.usage, "output_tokens", 0),
    }

    return result, usage


def call_openai(prompt: str) -> tuple[str, dict]:
    """Call OpenAI GPT-4 API with web search enabled.

    Returns: (response_text, usage_info)
    """
    try:
        import openai
    except ImportError:
        import subprocess
        subprocess.run([sys.executable, "-m", "pip", "install", "openai"], check=True)
        import openai

    client = openai.OpenAI()

    # Use responses API with web search tool
    response = client.responses.create(
        model=OPENAI_MODEL,
        tools=[{"type": "web_search_preview"}],
        input=prompt
    )

    # Extract text from response
    result = ""
    for item in response.output:
        if hasattr(item, "content"):
            for block in item.content:
                if hasattr(block, "text"):
                    result += block.text

    # Track token usage (OpenAI responses API format)
    usage = {
        "provider": "openai",
        "model": OPENAI_MODEL,
        "input_tokens": getattr(response, "input_tokens", 0),
        "output_tokens": getattr(response, "output_tokens", 0),
    }

    return result, usage


def call_with_retry(call_fn, prompt: str, provider_name: str) -> tuple[str, dict]:
    """Call an LLM function with retry logic."""
    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            return call_fn(prompt)
        except Exception as e:
            last_error = e
            print(f"  {provider_name} attempt {attempt + 1}/{MAX_RETRIES} failed: {e}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY_SECONDS)

    raise last_error


def call_llm(prompt: str) -> tuple[str, dict]:
    """Call LLM with automatic fallback between providers.

    Returns: (response_text, usage_info)
    """
    has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))
    has_openai = bool(os.environ.get("OPENAI_API_KEY"))

    if not has_anthropic and not has_openai:
        raise RuntimeError("No API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY")

    # Try primary provider first, fallback to secondary
    providers = []
    if has_anthropic:
        providers.append(("Anthropic Claude", call_anthropic))
    if has_openai:
        providers.append(("OpenAI GPT-4", call_openai))

    last_error = None
    for provider_name, call_fn in providers:
        print(f"Trying {provider_name}...")
        try:
            response, usage = call_with_retry(call_fn, prompt, provider_name)
            print(f"  Success! Tokens: {usage.get('input_tokens', '?')} in, {usage.get('output_tokens', '?')} out")
            return response, usage
        except Exception as e:
            last_error = e
            print(f"  {provider_name} failed after {MAX_RETRIES} retries: {e}")
            if len(providers) > 1:
                print("  Falling back to next provider...")

    raise RuntimeError(f"All providers failed. Last error: {last_error}")


def parse_response(response: str) -> dict:
    """Extract JSON from LLM response."""
    response = response.strip()

    # Remove markdown code blocks if present
    if "```json" in response:
        start = response.find("```json") + 7
        end = response.find("```", start)
        response = response[start:end]
    elif "```" in response:
        start = response.find("```") + 3
        end = response.find("```", start)
        response = response[start:end]

    # Extract JSON object from response (handles preamble and trailing text)
    response = response.strip()
    first_brace = response.find("{")
    last_brace = response.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        response = response[first_brace:last_brace + 1]

    return json.loads(response.strip())


def validate_event(event: dict) -> tuple[bool, str]:
    """Validate a single event against quality thresholds.

    Returns: (is_valid, reason)
    """
    # Check confidence threshold
    confidence = event.get("confidence", 0)
    if confidence < MIN_CONFIDENCE:
        return False, f"confidence {confidence:.2f} < {MIN_CONFIDENCE}"

    # Check job count thresholds
    jobs = event.get("tolls", {}).get("jobs", 0)
    if jobs < MIN_JOBS_PER_EVENT:
        return False, f"jobs {jobs} < {MIN_JOBS_PER_EVENT}"
    if jobs > MAX_JOBS_PER_EVENT:
        return False, f"jobs {jobs} > {MAX_JOBS_PER_EVENT} (sanity check)"

    # Check required fields
    if not event.get("headline"):
        return False, "missing headline"
    if not event.get("source_url"):
        return False, "missing source_url"

    return True, "ok"


def filter_events(events: list) -> tuple[list, list]:
    """Filter events by quality thresholds.

    Returns: (valid_events, rejected_events_with_reasons)
    """
    valid = []
    rejected = []

    for event in events:
        is_valid, reason = validate_event(event)
        if is_valid:
            valid.append(event)
        else:
            rejected.append({"event": event, "reason": reason})

    # Apply max events cap
    if len(valid) > MAX_EVENTS_PER_DAY:
        # Keep highest confidence events
        valid.sort(key=lambda e: e.get("confidence", 0), reverse=True)
        excess = valid[MAX_EVENTS_PER_DAY:]
        valid = valid[:MAX_EVENTS_PER_DAY]
        for event in excess:
            rejected.append({"event": event, "reason": f"exceeded {MAX_EVENTS_PER_DAY} events/day cap"})

    return valid, rejected


def log_usage(usage: dict) -> None:
    """Log token usage for cost tracking."""
    usage["timestamp"] = datetime.now(timezone.utc).isoformat()
    usage["date"] = get_today()

    with open(USAGE_FILE, "a") as f:
        f.write(json.dumps(usage) + "\n")

    # Calculate approximate cost (rough estimates)
    input_tokens = usage.get("input_tokens", 0)
    output_tokens = usage.get("output_tokens", 0)

    if usage.get("provider") == "anthropic":
        # Claude Sonnet pricing (approximate)
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000
    else:
        # GPT-4o pricing (approximate)
        cost = (input_tokens * 0.005 + output_tokens * 0.015) / 1000

    print(f"  Estimated cost: ${cost:.4f}")


def update_data(result: dict, rollup: dict) -> dict:
    """Update rollup with new events, aggregating by event_date."""
    events = result.get("events", [])
    collected_date = result.get("collected_date", get_today())

    # Load known event IDs for deduplication
    known_ids = load_known_event_ids()

    # Reset today's collection stats
    rollup["today"] = {"jobs": 0, "teams": 0, "products": 0, "companies": 0, "revenue": 0, "labor_hours": 0}

    new_events = []
    for event in events:
        # Skip duplicates
        event_id = event.get("id", "")
        headline = event.get("headline", "").lower().strip()
        if event_id in known_ids or headline in known_ids:
            continue

        # Get event date (when it happened) - fall back to collected date
        event_date = event.get("event_date") or event.get("date") or collected_date

        # Add metadata
        event["event_date"] = event_date
        event["collected_date"] = collected_date

        # For backwards compat, also set "date" to event_date
        event["date"] = event_date

        tolls = event.get("tolls", {})

        # Update today's collection totals
        for key in rollup["today"]:
            val = tolls.get(key) or 0
            rollup["today"][key] += val
            rollup["totals"][key] += val

        # Update daily_totals by event_date
        if event_date not in rollup["daily_totals"]:
            rollup["daily_totals"][event_date] = {"jobs": 0, "teams": 0, "products": 0, "companies": 0, "revenue": 0, "labor_hours": 0}

        for key in rollup["daily_totals"][event_date]:
            val = tolls.get(key) or 0
            rollup["daily_totals"][event_date][key] += val

        new_events.append(event)

    rollup["last_updated"] = datetime.now(timezone.utc).isoformat()
    rollup["events_count"] += len(new_events)

    # Include today's new events and summary
    rollup["summary"] = result.get("summary", "")
    rollup["events"] = new_events

    # Add new events to all_events and sort by event_date descending
    rollup["all_events"] = rollup.get("all_events", []) + new_events
    rollup["all_events"].sort(key=lambda e: e.get("event_date", ""), reverse=True)

    # Keep only last 100 events in all_events for the dashboard
    rollup["all_events"] = rollup["all_events"][:100]

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
    print(f"Config: max_tokens={MAX_TOKENS_RESPONSE}, min_confidence={MIN_CONFIDENCE}, max_events={MAX_EVENTS_PER_DAY}")

    # Build prompt and call LLM
    prompt = build_prompt()

    try:
        response, usage = call_llm(prompt)
    except Exception as e:
        print(f"LLM call failed: {e}")
        return 1

    # Log token usage
    log_usage(usage)

    # Validate response length
    print(f"Response received ({len(response)} chars)")
    if len(response) > MAX_RESPONSE_CHARS:
        print(f"WARNING: Response exceeds {MAX_RESPONSE_CHARS} chars - may indicate runaway output")

    # Parse response
    try:
        result = parse_response(response)
    except json.JSONDecodeError as e:
        print(f"Failed to parse response: {e}")
        print(f"Raw response:\n{response[:500]}...")
        return 1

    events = result.get("events", [])
    print(f"Found {len(events)} raw events")

    # Filter events by quality thresholds
    valid_events, rejected = filter_events(events)
    if rejected:
        print(f"Rejected {len(rejected)} events:")
        for r in rejected:
            headline = r["event"].get("headline", "?")[:50]
            print(f"  - {headline}... ({r['reason']})")

    result["events"] = valid_events
    print(f"Accepted {len(valid_events)} events after filtering")

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
