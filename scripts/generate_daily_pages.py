#!/usr/bin/env python3
"""Generate static daily pages from events data."""

import json
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timedelta, timezone

def load_template():
    """Load the daily page template."""
    template_path = Path(__file__).parent / "templates" / "daily_page.html"
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")
    return template_path.read_text()

def load_events():
    """Load all events from events.jsonl."""
    events_path = Path(__file__).parent.parent / "data" / "events.jsonl"
    if not events_path.exists():
        raise FileNotFoundError(f"Events file not found: {events_path}")
    events = []
    with open(events_path) as f:
        for line in f:
            if line.strip():
                events.append(json.loads(line))
    return events

def _infer_collection_date(event: dict) -> str | None:
    """Infer a YYYY-MM-DD date key for grouping.

    We group pages by the collection/report date ("collected_date") so the site
    reflects what was published each day, even when the underlying event_date is
    earlier.
    """
    d = event.get("collected_date")
    if isinstance(d, str) and len(d) >= 10:
        return d[:10]

    created_at = event.get("created_at")
    if isinstance(created_at, str) and len(created_at) >= 10:
        return created_at[:10]

    # Fallbacks for older data.
    d = event.get("event_date") or event.get("date")
    if isinstance(d, str) and len(d) >= 10:
        return d[:10]

    return None


def group_by_date(events):
    """Group events by collection date."""
    by_date = defaultdict(list)
    for event in events:
        date = _infer_collection_date(event)
        if date:
            by_date[date].append(event)
    return dict(by_date)

def format_date_display(date_str):
    """Format date for display: 'January 30, 2024'."""
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return dt.strftime("%B %d, %Y").replace(" 0", " ")

def format_date_short(date_str):
    """Format date short: 'Jan 30, 2024'."""
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return dt.strftime("%b %d, %Y").replace(" 0", " ")

def generate_event_html(event, idx):
    """Generate HTML for a single event entry."""
    jobs = event.get('tolls', {}).get('jobs', 0)
    confidence = int(event.get('confidence', 0.5) * 100)
    company = event.get('headline', '').split()[0] if event.get('headline') else 'Unknown'
    excerpt = event.get('excerpt', '') or event.get('notes', '') or ''
    source_url = event.get('source_url', '#')
    event_id = event.get('id', f'event-{idx}')

    return f'''
        <div class="entry" id="{event_id}">
            <div class="entry-main">
                <div class="entry-headline">
                    <span class="entry-company">{company}</span>
                    <span class="entry-jobs">{jobs:,}</span>
                </div>
                <div class="entry-meta">
                    {confidence}% · <a href="{source_url}" target="_blank" rel="noopener">source</a>
                </div>
                <div class="entry-excerpt">{excerpt}</div>
            </div>
        </div>'''

def generate_daily_page(date_str, events, template):
    """Generate a daily page for a specific date."""
    from urllib.parse import quote

    total_jobs = sum(e.get('tolls', {}).get('jobs', 0) for e in events)
    num_companies = len(events)

    date_display = format_date_display(date_str)
    date_short = format_date_short(date_str)
    canonical_url = f'https://dailyaitoll.com/{date_str.replace("-", "/")}'

    # Generate OG description and events HTML, with empty-day fallback so
    # /YYYY/MM/DD is always reachable even when the day had zero collected events.
    if num_companies == 0:
        og_description = "No AI displacement events recorded on this date."
        events_html = (
            '        <div class="entry no-events">\n'
            '            <div class="entry-main">\n'
            '                <div class="entry-excerpt">'
            'No qualifying AI displacement events were recorded on this date. '
            'See the <a href="/">running ledger</a> for surrounding days.'
            '</div>\n'
            '            </div>\n'
            '        </div>'
        )
    elif num_companies == 1:
        company = events[0].get('headline', '').split()[0]
        og_description = f"{company} announces {total_jobs:,} job cuts"
        events_html = '\n'.join(generate_event_html(e, i) for i, e in enumerate(events))
    else:
        og_description = f"{num_companies} companies announced {total_jobs:,} job cuts"
        events_html = '\n'.join(generate_event_html(e, i) for i, e in enumerate(events))

    # Generate share text
    share_text = f"{date_short}: {total_jobs:,} jobs displaced across {num_companies} {'company' if num_companies == 1 else 'companies'}\n\n#AI #Layoffs #Automation #FutureOfWork\n\nVia @DailyAIToll"
    share_title = f"Daily AI Toll - {date_short}"

    # Companies label (singular/plural)
    companies_label = "company" if num_companies == 1 else "companies"

    # Replace placeholders
    html = template.replace('{{DATE_DISPLAY}}', date_display)
    html = html.replace('{{DATE_SHORT}}', date_short)
    html = html.replace('{{DATE_ISO}}', date_str)
    html = html.replace('{{TOTAL_JOBS}}', f'{total_jobs:,}')
    html = html.replace('{{NUM_COMPANIES}}', str(num_companies))
    html = html.replace('{{NUM_COMPANIES_LABEL}}', companies_label)
    html = html.replace('{{OG_DESCRIPTION}}', og_description)
    html = html.replace('{{EVENTS_HTML}}', events_html)
    html = html.replace('{{SHARE_TEXT}}', share_text.replace('\n', '&#10;'))
    html = html.replace('{{SHARE_TEXT_ENCODED}}', quote(share_text))
    html = html.replace('{{SHARE_TITLE_ENCODED}}', quote(share_title))
    html = html.replace('{{CANONICAL_URL}}', canonical_url)
    html = html.replace('{{CANONICAL_URL_ENCODED}}', quote(canonical_url, safe=''))

    return html

def main():
    base_dir = Path(__file__).parent.parent
    web_dir = base_dir / "web"

    try:
        print("Loading template...")
        template = load_template()
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        return 1

    try:
        print("Loading events...")
        events = load_events()
        print(f"Loaded {len(events)} events")
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        return 1

    print("Grouping by date...")
    by_date = group_by_date(events)
    print(f"Found {len(by_date)} unique dates")

    if len(by_date) == 0:
        print("WARNING: No dates found in events - no pages will be generated")
        return 0

    print("Generating daily pages...")
    pages_generated = 0
    for date_str, date_events in sorted(by_date.items()):
        # Create directory structure: web/2024/01/30/index.html
        year, month, day = date_str.split('-')
        page_dir = web_dir / year / month / day
        page_dir.mkdir(parents=True, exist_ok=True)

        html = generate_daily_page(date_str, date_events, template)

        output_path = page_dir / "index.html"
        output_path.write_text(html)
        pages_generated += 1

        total_jobs = sum(e.get('tolls', {}).get('jobs', 0) for e in date_events)
        print(f"  {date_str}: {len(date_events)} events, {total_jobs:,} jobs → {output_path.relative_to(base_dir)}")

    # Fill in placeholder pages for any missing dates between the earliest
    # collected date and today (UTC). Without this, days where the collector
    # found zero events return a 404 even though the site is operating.
    placeholders_generated = 0
    try:
        sorted_dates = sorted(by_date.keys())
        first_date = datetime.strptime(sorted_dates[0], "%Y-%m-%d").date()
        today = datetime.now(timezone.utc).date()
        cur = first_date
        while cur <= today:
            date_str = cur.isoformat()
            if date_str not in by_date:
                year, month, day = date_str.split('-')
                output_path = web_dir / year / month / day / "index.html"
                if not output_path.exists():
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    output_path.write_text(generate_daily_page(date_str, [], template))
                    placeholders_generated += 1
                    print(f"  {date_str}: placeholder (0 events) → {output_path.relative_to(base_dir)}")
            cur += timedelta(days=1)
    except (ValueError, IndexError) as e:
        print(f"WARNING: skipping placeholder fill: {e}")

    print(f"\nGenerated {pages_generated} daily pages ({placeholders_generated} placeholders)")
    return 0

if __name__ == "__main__":
    import sys
    sys.exit(main())
