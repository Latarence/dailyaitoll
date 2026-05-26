#!/usr/bin/env python3
"""Export events.jsonl to a full CSV for licensed downloads."""

import csv
import json
from pathlib import Path


def main() -> int:
    root = Path(__file__).parent.parent
    events_path = root / "data" / "events.jsonl"
    out_path = root / "web" / "data" / "events.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not events_path.exists():
        raise FileNotFoundError(f"Events file not found: {events_path}")

    rows = []
    with events_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))

    # Stable ordering: newest first by created_at, then event_date.
    def key(e: dict):
        return (e.get("created_at", ""), e.get("event_date", ""))

    rows.sort(key=key, reverse=True)

    fieldnames = [
        "id",
        "event_date",
        "collected_date",
        "company",
        "jobs",
        "headline",
        "excerpt",
        "source_name",
        "source_url",
        "causality",
        "confidence",
        "created_at",
    ]

    with out_path.open("w", encoding="utf-8", newline="") as out:
        w = csv.DictWriter(out, fieldnames=fieldnames)
        w.writeheader()
        for e in rows:
            headline = e.get("headline") or ""
            company = headline.split()[0] if headline else ""
            w.writerow(
                {
                    "id": e.get("id", ""),
                    "event_date": e.get("event_date") or e.get("date") or "",
                    "collected_date": e.get("collected_date") or "",
                    "company": company,
                    "jobs": (e.get("tolls") or {}).get("jobs") or 0,
                    "headline": headline,
                    "excerpt": e.get("excerpt") or e.get("notes") or "",
                    "source_name": e.get("source_name") or "",
                    "source_url": e.get("source_url") or "",
                    "causality": e.get("causality") or "",
                    "confidence": e.get("confidence") if e.get("confidence") is not None else "",
                    "created_at": e.get("created_at") or "",
                }
            )

    print(f"Wrote {len(rows)} rows -> {out_path.relative_to(root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
