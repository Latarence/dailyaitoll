"""Every page header keeps the theme toggle visible at <=640px: theme button + hamburger share the
.nav-mobile-actions wrapper (same as /), and the 640px media query shows that wrapper."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = sorted((ROOT / "web").rglob("index.html")) + [ROOT / "scripts" / "templates" / "daily_page.html"]


def test_header_has_mobile_actions_wrapper():
    bad = []
    for p in PAGES:
        s = p.read_text()
        if 'class="hamburger"' not in s:
            continue
        m = re.search(r'<div class="nav-mobile-actions">\s*<button class="theme-btn"[^>]*>.*?</button>\s*'
                      r'<button class="hamburger"', s, re.S)
        shown = re.search(r'@media \(max-width: 640px\)\s*\{[^@]*?\.nav-mobile-actions\s*\{\s*display:\s*flex;\s*\}', s)
        if not (m and shown):
            bad.append(str(p.relative_to(ROOT)))
    assert not bad, f"header missing mobile theme toggle: {bad}"
