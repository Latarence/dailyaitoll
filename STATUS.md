# Daily AI Toll — Project Status

**Last Updated:** 2026-04-26

## Quick Start

```bash
# Local development
cd /Users/latarencebutts/latarence/dailyaitoll
python scripts/run_toll.py

# Manual trigger (requires GITHUB_TOKEN)
GITHUB_TOKEN=ghp_... ./scripts/trigger.sh

# View site locally
cd web && python -m http.server 8000
```

## Service Ports

| Service | Port | URL |
|---------|------|-----|
| Web (Vercel) | 443 | https://dailyaitoll.com |
| Local dev | 8000 | http://localhost:8000 |

## Infrastructure

| Component | Status | Details |
|-----------|--------|---------|
| Domain | ✅ Active | dailyaitoll.com (GoDaddy → Cloudflare) |
| DNS | ✅ Active | Cloudflare zone `53666f866ac83f42b8ab6f5e65117a0e` |
| Hosting | ✅ Active | Vercel project `prj_UV8D8Z2gnT4hCHFEHGcbszQuh1fc` |
| GitHub | ✅ Active | https://github.com/Latarence/dailyaitoll |
| Actions | ✅ Configured | Cron at 11:55 PM EDT (03:55 UTC) |

## Schedule

- **Daily run:** 11:55 PM EDT (03:55 UTC)
- **Report ready:** By midnight EDT
- **Auto-commits:** Yes (no PR required)

## Bugs Fixed Today (2026-04-26)

1. **Cron timing** — Changed from 6 AM UTC to 11:55 PM EDT (03:55 UTC)
2. **PR workflow** — Changed to auto-commit for scheduled runs
3. **Architecture simplification** — LLM does search, no code-based fetching
4. **HTML scaling** — Single page + JSON data, no per-day HTML files

## Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| ANTHROPIC_API_KEY not in GitHub secrets | HIGH | ✅ DONE |
| OPENAI_API_KEY not configured | MEDIUM | ✅ DONE |
| First collection run not yet executed | LOW | Ready to test |

## API Keys

Script supports both providers (uses whichever key is available):

| Key | GitHub Secret | Source |
|-----|---------------|--------|
| OpenAI | `OPENAI_API_KEY` | MDO3 account (see API_Tokens_Fillout.md) |
| Anthropic | `ANTHROPIC_API_KEY` | Tillio env on bigmini |

Priority: Anthropic first, falls back to OpenAI if not set.

## File Structure

```
dailyaitoll/
├── .github/workflows/daily-toll.yml  # GitHub Actions
├── config/sources.yaml               # Source configuration
├── data/
│   ├── events.jsonl                  # Event log (append-only)
│   └── daily_rollup.json             # Aggregated totals
├── docs/methodology.md               # Scoring criteria
├── reports/daily/                    # Daily markdown reports
├── scripts/
│   ├── run_toll.py                   # Main collection script
│   └── trigger.sh                    # Manual trigger
├── web/
│   ├── index.html                    # Dashboard (single page)
│   └── data/daily_rollup.json        # Dashboard data
├── README.md
├── STATUS.md                         # This file
└── requirements.txt
```

## Next Steps

1. Get ANTHROPIC_API_KEY from Tillio env on bigmini
2. Get OPENAI_API_KEY from Tillio env on bigmini
3. Add both to GitHub secrets
4. Make service provider interchangeable (Anthropic/OpenAI)
5. Run first collection
