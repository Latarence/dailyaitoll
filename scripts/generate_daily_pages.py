#!/usr/bin/env python3
"""Generate static daily pages from events data."""

import json
from pathlib import Path
from collections import defaultdict
from datetime import datetime

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

def group_by_date(events):
    """Group events by date."""
    by_date = defaultdict(list)
    for event in events:
        date = event.get('event_date') or event.get('date')
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

    # Generate OG description
    if num_companies == 1:
        company = events[0].get('headline', '').split()[0]
        og_description = f"{company} announces {total_jobs:,} job cuts"
    else:
        og_description = f"{num_companies} companies announced {total_jobs:,} job cuts"

    # Generate events HTML
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

    print(f"\nGenerated {pages_generated} daily pages")
    return 0

if __name__ == "__main__":
    import sys
    sys.exit(main())
