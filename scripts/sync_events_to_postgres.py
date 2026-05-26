#!/usr/bin/env python3
"""Sync events.jsonl into Postgres for gated downloads.

Designed to run in GitHub Actions (after collection) with POSTGRES_URL set.
"""

import json
import os
from pathlib import Path


def main() -> int:
    postgres_url = os.getenv("POSTGRES_URL") or os.getenv("DATABASE_URL")
    if not postgres_url:
        raise RuntimeError("Missing POSTGRES_URL (or DATABASE_URL)")

    try:
        import psycopg
    except ImportError as e:
        raise RuntimeError("psycopg is required. Add it to requirements.txt") from e

    root = Path(__file__).parent.parent
    events_path = root / "data" / "events.jsonl"
    if not events_path.exists():
        raise FileNotFoundError(f"Events file not found: {events_path}")

    events = []
    with events_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            events.append(json.loads(line))

    with psycopg.connect(postgres_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
                  id TEXT PRIMARY KEY,
                  event_date DATE,
                  collected_date DATE,
                  headline TEXT,
                  excerpt TEXT,
                  source_name TEXT,
                  source_url TEXT,
                  causality TEXT,
                  confidence DOUBLE PRECISION,
                  jobs INTEGER,
                  created_at TIMESTAMPTZ
                );
                """
            )

            upserts = 0
            for e in events:
                eid = e.get("id")
                if not eid:
                    continue

                tolls = e.get("tolls") or {}
                cur.execute(
                    """
                    INSERT INTO events (
                      id, event_date, collected_date, headline, excerpt, source_name, source_url,
                      causality, confidence, jobs, created_at
                    )
                    VALUES (
                      %(id)s,
                      %(event_date)s,
                      %(collected_date)s,
                      %(headline)s,
                      %(excerpt)s,
                      %(source_name)s,
                      %(source_url)s,
                      %(causality)s,
                      %(confidence)s,
                      %(jobs)s,
                      %(created_at)s
                    )
                    ON CONFLICT (id)
                    DO UPDATE SET
                      event_date = EXCLUDED.event_date,
                      collected_date = EXCLUDED.collected_date,
                      headline = EXCLUDED.headline,
                      excerpt = EXCLUDED.excerpt,
                      source_name = EXCLUDED.source_name,
                      source_url = EXCLUDED.source_url,
                      causality = EXCLUDED.causality,
                      confidence = EXCLUDED.confidence,
                      jobs = EXCLUDED.jobs,
                      created_at = EXCLUDED.created_at;
                    """,
                    {
                        "id": eid,
                        "event_date": (e.get("event_date") or e.get("date") or None),
                        "collected_date": (e.get("collected_date") or None),
                        "headline": (e.get("headline") or ""),
                        "excerpt": (e.get("excerpt") or e.get("notes") or ""),
                        "source_name": (e.get("source_name") or ""),
                        "source_url": (e.get("source_url") or ""),
                        "causality": (e.get("causality") or ""),
                        "confidence": e.get("confidence"),
                        "jobs": int(tolls.get("jobs") or 0),
                        "created_at": e.get("created_at"),
                    },
                )
                upserts += 1

        conn.commit()

    print(f"Upserted {upserts} events")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
