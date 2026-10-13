#!/usr/bin/env python3
"""Citation link checker for Daily AI Toll (C7-006).

Collects every external link from the built pages (web/**/*.html) and every
source_url in data/events.jsonl, then (unless --offline) checks each unique URL
and writes a CSV. Optionally looks dead links up in the Wayback Machine and
applies honest fixes.

Usage:
  python scripts/check_links.py --offline                 # extract only, no network
  python scripts/check_links.py --out links.csv           # check every link
  python scripts/check_links.py --wayback --out links.csv # + archived URL for dead links
  python scripts/check_links.py --from-csv links.csv --apply
      # rewrite data/events.jsonl and static pages from a checked CSV:
      #   dead + archived -> link points to the Wayback snapshot
      #   dead, no archive -> link removed, text marked "(source no longer available)"

Status classes:
  ok       2xx/3xx after redirects
  dead     404 or 410 (the page is gone)
  blocked  401/403/429/202/999 or a TLS/bot wall (site refuses robots; NOT counted dead)
  error    timeouts, DNS failures, 5xx (re-check before treating as dead)
Only "dead" links are ever rewritten. No source is ever invented.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
EVENTS = ROOT / "data" / "events.jsonl"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
UNAVAILABLE = "(source no longer available)"
# Our own and infrastructure hosts are not citations.
SKIP_HOSTS = {"dailyaitoll.com", "www.dailyaitoll.com", "fonts.googleapis.com",
              "fonts.gstatic.com", "web.archive.org", "buy.stripe.com",
              "billing.stripe.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com",
              "www.googletagmanager.com", "plausible.io", "schema.org", "www.w3.org"}
HREF_RE = re.compile(r'<a\b[^>]*?\bhref="(https?://[^"]+)"[^>]*>(.*?)</a>', re.S | re.I)


# Share buttons and our own social profiles are not citations.
SKIP_PATTERNS = ("/intent/", "/shareArticle", "linkedin.com/company/dailyaitoll",
                 "bsky.app/profile/", "twitter.com/DailyAIToll", "x.com/DailyAIToll")


def is_citation(url: str) -> bool:
    host = urllib.parse.urlsplit(url).hostname or ""
    if any(p in url for p in SKIP_PATTERNS):
        return False
    return host not in SKIP_HOSTS and not host.endswith(".vercel.app")


def collect() -> dict[str, set[str]]:
    """url -> set of places it appears (page paths / 'events.jsonl')."""
    found: dict[str, set[str]] = defaultdict(set)
    for page in sorted(WEB.rglob("*.html")):
        if "node_modules" in page.parts:
            continue
        rel = str(page.relative_to(WEB.parent))
        for m in HREF_RE.finditer(page.read_text(encoding="utf-8", errors="replace")):
            url = html.unescape(m.group(1))
            if is_citation(url):
                found[url].add(rel)
    if EVENTS.exists():
        for line in EVENTS.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            ev = json.loads(line)
            url = ev.get("source_url")
            if url and url.startswith("http") and is_citation(url):
                found[url].add("data/events.jsonl")
    return found


def fetch_status(url: str, timeout: float) -> tuple[str, str]:
    """Return (http_status_or_error, final_url). HEAD first, GET on any non-2xx."""
    last = ("error", url)
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers={
            "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return str(r.status), r.geturl()
        except urllib.error.HTTPError as e:
            last = (str(e.code), url)
        except Exception as e:  # noqa: BLE001 - network errors of every kind
            last = (f"error:{type(e).__name__}", url)
    return last


def classify(status: str) -> str:
    if status.isdigit():
        code = int(status)
        if code in (404, 410):
            return "dead"
        if code in (401, 403, 429, 202, 999):
            return "blocked"
        if 200 <= code < 400:
            return "ok"
        return "error"
    if "SSL" in status or "Certificate" in status:
        return "blocked"
    return "error"


def wayback(url: str, timeout: float) -> str:
    # Keep ":" and "/" literal: the availability API returns no snapshot for a fully
    # percent-encoded URL (verified 2026-10-13 on a TechCrunch URL that has a 200 snapshot).
    api = "https://archive.org/wayback/available?url=" + urllib.parse.quote(url, safe=":/")
    for attempt in range(3):
        try:
            req = urllib.request.Request(api, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                snap = (json.load(r).get("archived_snapshots") or {}).get("closest") or {}
            if snap.get("available") and str(snap.get("status", "")).startswith("2"):
                return snap["url"].replace("http://web.archive.org", "https://web.archive.org")
            return ""
        except Exception:  # noqa: BLE001
            time.sleep(2 * (attempt + 1))
    return "lookup-failed"


def check(found, args) -> list[dict]:
    rows = []
    urls = sorted(found)

    def one(u):
        st, final = fetch_status(u, args.timeout)
        return u, st, final

    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for i, (u, st, final) in enumerate(ex.map(one, urls), 1):
            cls = classify(st)
            rows.append({"url": u, "status": st, "class": cls, "final_url": final if final != u else "",
                         "wayback_url": "", "pages": len(found[u]),
                         "where": " ".join(sorted(found[u]))})
            if i % 25 == 0:
                print(f"  checked {i}/{len(urls)}", file=sys.stderr)
    if args.wayback:
        for r in rows:
            if r["class"] == "dead":
                r["wayback_url"] = wayback(r["url"], args.timeout)
                time.sleep(1)
    return rows


def apply_fixes(rows: list[dict]) -> dict[str, int]:
    # A failed archive lookup is not "no archive": leave those links for the next run.
    dead = {r["url"]: r.get("wayback_url", "") for r in rows
            if r["class"] == "dead" and r.get("wayback_url", "") != "lookup-failed"}
    dead = {u: (w if w.startswith("https://web.archive.org/") else "") for u, w in dead.items()}
    stats = {"archived": 0, "unlinked": 0, "pages_changed": 0, "events_changed": 0}
    if not dead:
        return stats
    # 1. Data: generated pages are rebuilt from events.jsonl.
    if EVENTS.exists():
        out = []
        for line in EVENTS.read_text(encoding="utf-8").splitlines():
            if line.strip():
                ev = json.loads(line)
                u = ev.get("source_url")
                if u in dead:
                    ev.setdefault("source_url_original", u)
                    if dead[u]:
                        ev["source_url"] = dead[u]
                        ev["source_archived"] = True
                    else:
                        ev["source_url"] = None
                        ev["source_unavailable"] = True
                    stats["events_changed"] += 1
                    # Only changed lines are re-serialized (same style as run_toll.py);
                    # every other line stays byte-for-byte as it was.
                    line = json.dumps(ev)
            out.append(line)
        EVENTS.write_text("\n".join(out) + "\n", encoding="utf-8")
    # 2. Static pages (incl. pages the generator no longer rewrites).
    for page in sorted(WEB.rglob("*.html")):
        if "node_modules" in page.parts:
            continue
        text = page.read_text(encoding="utf-8", errors="replace")

        def sub(m):
            url = html.unescape(m.group(1))
            if url not in dead:
                return m.group(0)
            if dead[url]:
                stats["archived"] += 1
                tag = m.group(0)
                return (tag.replace(m.group(1), html.escape(dead[url], quote=True), 1)
                        .replace(">" + m.group(2) + "</a>", ">" + m.group(2) + " (archived)</a>", 1))
            stats["unlinked"] += 1
            text = m.group(2).strip()
            label = UNAVAILABLE if text.lower() == "source" else f"{text} {UNAVAILABLE}"
            return f'<span class="source-unavailable">{label}</span>'

        new = HREF_RE.sub(sub, text)
        if new != text:
            page.write_text(new, encoding="utf-8")
            stats["pages_changed"] += 1
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="link_check.csv", help="CSV output path")
    ap.add_argument("--offline", action="store_true", help="extract links only, no network")
    ap.add_argument("--wayback", action="store_true", help="look up Wayback snapshots for dead links")
    ap.add_argument("--from-csv", help="reuse a previously checked CSV instead of re-checking")
    ap.add_argument("--apply", action="store_true", help="rewrite dead links (needs a checked CSV)")
    ap.add_argument("--web-dir", help="pages to scan instead of web/ (e.g. a mirror of the live site)")
    ap.add_argument("--no-events", action="store_true", help="skip data/events.jsonl")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--timeout", type=float, default=20)
    args = ap.parse_args()

    global WEB, EVENTS
    if args.web_dir:
        WEB = Path(args.web_dir).resolve()
    if args.no_events:
        EVENTS = ROOT / "data" / "__none__.jsonl"
    if args.from_csv:
        with open(args.from_csv, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
    else:
        found = collect()
        pages = {p for s in found.values() for p in s if p.endswith(".html")}
        print(f"{len(found)} unique citation URLs across {len(pages)} pages", file=sys.stderr)
        if args.offline:
            rows = [{"url": u, "status": "", "class": "unchecked", "final_url": "", "wayback_url": "",
                     "pages": len(found[u]), "where": " ".join(sorted(found[u]))} for u in sorted(found)]
        else:
            rows = check(found, args)
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["url", "status", "class", "final_url", "wayback_url", "pages", "where"])
            w.writeheader()
            w.writerows(rows)
        print(f"wrote {args.out}", file=sys.stderr)

    counts = defaultdict(int)
    for r in rows:
        counts[r["class"]] += 1
    print("summary: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    dead_pages = {p for r in rows if r["class"] == "dead" for p in r["where"].split() if p.endswith(".html")}
    if counts.get("dead"):
        print(f"pages with a dead citation: {len(dead_pages)}")
    if args.apply:
        print("applied: " + json.dumps(apply_fixes(rows)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
