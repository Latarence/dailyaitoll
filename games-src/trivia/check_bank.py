#!/usr/bin/env python3
"""Bank check for /trivia: schema, size, unique ids and texts, sources with a URL, copy rules."""
import json, re, sys, collections
b = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "games-src/trivia/questions.json"))
qs, bad = b["questions"], []
if len(qs) < 155: bad.append(f"only {len(qs)} questions (need 155)")
ids = collections.Counter(q["id"] for q in qs)
bad += [f"dup id {i}" for i, n in ids.items() if n > 1]
texts = collections.Counter(q["q"].strip().lower() for q in qs)
bad += [f"dup question {t[:50]}" for t, n in texts.items() if n > 1]
BANNED = re.compile(r"—|–|\bincluding\b|\bfree\b|\bAHL\b|Anne Huntington", re.I)
for q in qs:
    if len(q.get("options", [])) != 4 or len(set(q["options"])) != 4: bad.append(f"{q['id']} options")
    if not isinstance(q.get("answer"), int) or not 0 <= q["answer"] <= 3: bad.append(f"{q['id']} answer")
    if not re.search(r"https?://", q.get("source", "")): bad.append(f"{q['id']} source url")
    for k in ("topic", "q", "explain", "source"):
        if not q.get(k): bad.append(f"{q['id']} missing {k}")
    blob = " ".join([q["q"], q["explain"]] + q["options"])
    if BANNED.search(blob): bad.append(f"{q['id']} copy rule: {BANNED.search(blob).group(0)}")
pos = collections.Counter(q["answer"] for q in qs)
print("BANK", len(qs), "questions;", dict(collections.Counter(q["topic"] for q in qs)), "; answer positions", dict(pos))
print("BANK CHECK " + ("FAIL\n  " + "\n  ".join(bad) if bad else "PASS"))
sys.exit(1 if bad else 0)
