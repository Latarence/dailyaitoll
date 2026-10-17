#!/usr/bin/env python3
"""Write web/play/cards.json: the card pool for the /play game (Tally), taken from data/events.jsonl.

Only real ledger entries go in. A card needs a role count (tolls.jobs) that appears, as written, in the
event's own headline or source excerpt, a confidence of 0.8 or more, and a source URL; reports that
call the count unconfirmed or an estimate are left out. Repeat reports of the
same cut (same company word, same count) keep the earliest. Numbers in the shown text are masked so the
player places the card before seeing its count. Run by generate_daily_pages.py; safe to run by hand.
"""
import json
import re
import sys
from pathlib import Path

MIN_CONFIDENCE = 0.8
# the site never calls anything "free" (lab copy rule); a source excerpt that uses the word is not shown on a card
NOT_SHOWN = re.compile(r"\bfree\b", re.I)
UNCONFIRMED = re.compile(r"undisclosed|not been confirmed|estimat|could be", re.I)
CITE = re.compile(r'[<(]?\s*cite index="[^"]*"\s*>|</cite>\)?')
NUM = re.compile(r"(?<![A-Za-z0-9])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s*%|\s*percent)?(?![A-Za-z0-9])")


def numbers_in(text):
    out = set()
    for m in NUM.finditer(text or ""):
        if m.group(2):
            continue
        try:
            out.add(float(m.group(1).replace(",", "")))
        except ValueError:
            pass
    return out


def mask(text, jobs):
    def sub(m):
        if m.group(2):
            return m.group(0)
        v = float(m.group(1).replace(",", ""))
        is_year = m.group(1).isdigit() and len(m.group(1)) == 4 and 1900 <= v <= 2099 and v != jobs
        if v == jobs or (v >= 10 and not is_year):
            return "###"
        return m.group(0)
    return NUM.sub(sub, text or "")


def build(base: Path) -> dict:
    events = []
    with open(base / "data" / "events.jsonl") as f:
        for line in f:
            line = line.strip()
            if line:
                events.append(json.loads(line))
    events.sort(key=lambda e: (e.get("event_date") or e.get("date") or "", e.get("id", "")))
    seen = set()
    cards = []
    for e in events:
        jobs = (e.get("tolls") or {}).get("jobs")
        if not isinstance(jobs, (int, float)) or jobs <= 0:
            continue
        if (e.get("confidence") or 0) < MIN_CONFIDENCE or not e.get("source_url"):
            continue
        head = e.get("headline") or ""
        exc = re.sub(r"\s+", " ", CITE.sub("", e.get("excerpt") or "")).strip()
        if UNCONFIRMED.search(head + " " + exc):
            continue
        if float(jobs) not in numbers_in(head) | numbers_in(exc):
            continue
        key = (int(jobs), (head.split() or [""])[0].lower().strip(".,"))
        if key in seen:
            continue
        seen.add(key)
        cards.append({
            "id": e["id"],
            "date": e.get("event_date") or e.get("date"),
            "roles": int(jobs),
            "headline": head,
            "masked": mask(head, jobs),
            "excerpt": mask(exc, jobs) if len(exc) >= 40 and not NOT_SHOWN.search(exc) else "",
            "source": e.get("source_name") or "",
            "url": e.get("source_url"),
            "causality": e.get("causality") or "",
            "confidence": e.get("confidence"),
        })
    return {"built_from": "data/events.jsonl", "rule": "roles figure appears in the cited headline or excerpt; confidence >= 0.8; reports that call the count unconfirmed or an estimate are left out; repeats removed", "count": len(cards), "cards": cards}


def main(base: Path) -> int:
    pool = build(base)
    out = base / "web" / "play" / "cards.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(pool, indent=1, ensure_ascii=False) + "\n")
    return pool["count"]


if __name__ == "__main__":
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    print(f"Wrote web/play/cards.json ({main(base)} cards)")
