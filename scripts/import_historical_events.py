#!/usr/bin/env python3
"""Import historical AI layoff events from Excel files into events.jsonl"""

import pandas as pd
import json
from datetime import datetime
from pathlib import Path
import re

def parse_date(date_str):
    """Parse various date formats to ISO format."""
    if pd.isna(date_str):
        return None
    date_str = str(date_str).strip()
    formats = [
        "%b %d, %Y",  # Apr 15, 2026
        "%B %d, %Y",  # April 15, 2026
        "%b %Y",      # Dec 2024
        "%Y-%m-%d",   # 2024-01-15
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            if fmt == "%b %Y":
                return dt.strftime("%Y-%m-15")  # Default to mid-month
            return dt.strftime("%Y-%m-%d")
        except:
            continue
    return None

def parse_jobs(jobs_str):
    """Parse job numbers, handling ~ prefix and text."""
    if pd.isna(jobs_str):
        return 0
    jobs_str = str(jobs_str).strip()
    jobs_str = re.sub(r'[~+,]', '', jobs_str)
    try:
        return int(float(jobs_str))
    except:
        return 0

def parse_ai_factor(factor_str):
    """Parse AI factor percentage to confidence score."""
    if pd.isna(factor_str):
        return 0.5
    factor_str = str(factor_str).strip().replace('%', '')
    try:
        return float(factor_str) / 100
    except:
        return 0.5

def determine_causality(ai_attribution):
    """Determine causality from AI attribution text."""
    if pd.isna(ai_attribution):
        return "inferred"
    ai_attr = str(ai_attribution).lower()
    if "direct" in ai_attr:
        return "direct"
    elif "indirect" in ai_attr:
        return "contributing"
    return "inferred"

def generate_id(date, company, idx):
    """Generate unique event ID."""
    date_part = date.replace("-", "") if date else "00000000"
    company_slug = re.sub(r'[^a-z0-9]', '', company.lower())[:8]
    return f"evt_{date_part}_{company_slug}_{str(idx).zfill(3)}"

def process_batch3(filepath):
    """Process ai_toll_batch3_2023_2024.xlsx"""
    df = pd.read_excel(filepath)
    events = []

    for idx, row in df.iterrows():
        date = parse_date(row.get('Date'))
        if not date:
            continue

        company = str(row.get('Company', '')).strip()
        jobs = parse_jobs(row.get('Jobs Cut'))
        description = str(row.get('Description', '')) if pd.notna(row.get('Description')) else ""
        source_url = str(row.get('Source URL', '')).split('|')[0].strip() if pd.notna(row.get('Source URL')) else ""

        headline = f"{company} cuts {jobs:,} jobs amid AI transition" if jobs > 0 else f"{company} reduces workforce citing AI efficiency"

        event = {
            "id": generate_id(date, company, idx + 100),
            "event_date": date,
            "collected_date": datetime.now().strftime("%Y-%m-%d"),
            "headline": headline,
            "source_url": source_url,
            "source_name": "TrueUp",
            "excerpt": description[:500],
            "causality": determine_causality(row.get('AI Attribution')),
            "confidence": 0.7,
            "tolls": {
                "jobs": jobs,
                "teams": 0,
                "companies": 1,
                "labor_hours": -jobs * 2080
            },
            "notes": description,
            "industry": str(row.get('Industry', '')) if pd.notna(row.get('Industry')) else "",
            "hashtags": str(row.get('Hashtags', '')) if pd.notna(row.get('Hashtags')) else "",
            "date": date,
            "created_at": datetime.now().isoformat()
        }
        events.append(event)

    return events

def process_layoffs(filepath):
    """Process ai_layoffs_2023_to_jan2025.xlsx"""
    df = pd.read_excel(filepath, header=None)
    events = []

    start_row = None
    for i, row in df.iterrows():
        if str(row[0]).strip() == "Date":
            start_row = i
            break

    if not start_row:
        return events

    for idx, row in df.iloc[start_row + 1:].iterrows():
        date_val = str(row[0]).strip() if pd.notna(row[0]) else ""

        if any(x in date_val for x in ["📅", "⚡", "BATCH", "AI-influenced"]):
            continue
        if not date_val:
            continue

        date = parse_date(date_val)
        if not date:
            continue

        company = str(row[1]).strip() if pd.notna(row[1]) else ""
        if not company or company == "nan":
            continue

        jobs = parse_jobs(row[2])
        confidence = parse_ai_factor(row[3])
        source_name = str(row[4]).strip() if pd.notna(row[4]) else "Various"
        source_url = str(row[5]).strip() if pd.notna(row[5]) else ""
        hashtags = str(row[6]).strip() if pd.notna(row[6]) else ""
        notes = str(row[7]).strip() if pd.notna(row[7]) else ""

        headline = f"{company} cuts {jobs:,} jobs" if jobs > 0 else f"{company} reduces workforce"

        event = {
            "id": generate_id(date, company, idx + 200),
            "event_date": date,
            "collected_date": datetime.now().strftime("%Y-%m-%d"),
            "headline": headline,
            "source_url": source_url,
            "source_name": source_name,
            "excerpt": notes[:500],
            "causality": "contributing" if confidence > 0.6 else "inferred",
            "confidence": confidence,
            "tolls": {
                "jobs": jobs,
                "teams": 0,
                "companies": 1,
                "labor_hours": -jobs * 2080
            },
            "notes": notes,
            "hashtags": hashtags,
            "date": date,
            "created_at": datetime.now().isoformat()
        }
        events.append(event)

    return events

def main():
    base_dir = Path(__file__).parent.parent

    batch3_file = base_dir / "ai_toll_batch3_2023_2024.xlsx"
    layoffs_file = base_dir / "ai_layoffs_2023_to_jan2025.xlsx"
    output_file = base_dir / "data" / "events.jsonl"

    # Load existing events
    existing_events = []
    existing_ids = set()
    if output_file.exists():
        with open(output_file, 'r') as f:
            for line in f:
                if line.strip():
                    event = json.loads(line)
                    existing_events.append(event)
                    existing_ids.add(event['id'])

    print(f"Existing events: {len(existing_events)}")

    # Process new events
    new_events = []

    if batch3_file.exists():
        batch3_events = process_batch3(batch3_file)
        print(f"Batch3 events: {len(batch3_events)}")
        new_events.extend(batch3_events)

    if layoffs_file.exists():
        layoffs_events = process_layoffs(layoffs_file)
        print(f"Layoffs events: {len(layoffs_events)}")
        new_events.extend(layoffs_events)

    # Deduplicate
    added = 0
    for event in new_events:
        if event['id'] not in existing_ids:
            existing_events.append(event)
            existing_ids.add(event['id'])
            added += 1

    # Sort by date
    existing_events.sort(key=lambda x: x.get('event_date', ''), reverse=True)

    # Write output
    with open(output_file, 'w') as f:
        for event in existing_events:
            f.write(json.dumps(event) + '\n')

    print(f"\nAdded {added} new events")
    print(f"Total events: {len(existing_events)}")

    # Calculate totals
    total_jobs = sum(e['tolls']['jobs'] for e in existing_events)
    total_companies = len(set(e.get('headline', '').split()[0] for e in existing_events))
    print(f"Total jobs affected: {total_jobs:,}")
    print(f"Unique companies: {total_companies}")

if __name__ == "__main__":
    main()
