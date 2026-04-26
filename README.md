# Daily AI Toll

Evidence-based tracking of AI-driven displacement across jobs, teams, products, companies, revenue, and labor.

**Live site:** https://dailyaitoll.com

## Overview

Daily AI Toll is a GitHub-hosted, agent-driven system that collects and tracks verifiable instances of AI replacing human work. Every entry requires evidence—no speculation, no projections.

## Architecture

```
GitHub Actions (cron/dispatch)
        │
        ▼
   Python Wrapper
        │
        ▼
  Claude Code CLI ──► Processes news/sources
        │
        ▼
   Updates repo (data/*.jsonl, reports/)
        │
        ▼
   Creates PR for human review
        │
        ▼
   Human merges after verification
```

## Toll Segments

| Segment | Description | Unit |
|---------|-------------|------|
| **Job Toll** | Individual roles eliminated or reduced | Roles |
| **Team Toll** | Teams downsized or restructured | Teams |
| **Product Toll** | Products/services sunset due to AI | Products |
| **Company Toll** | Companies affected by AI disruption | Companies |
| **Revenue Toll** | Revenue impact from AI displacement | USD |
| **Labor Toll** | Hours reduced, created, or net change | Hours |

## Key Rules

1. **No evidence, no entry** — Every event must have a verifiable source
2. **Required fields** — Source URL, excerpt, causality assessment, confidence score
3. **Pending review** — Uncertain items flagged for human verification
4. **Multiple tolls** — One event can generate entries across multiple segments

## Data Schema

### Event Record (`data/events.jsonl`)

```json
{
  "id": "evt_20260426_001",
  "date": "2026-04-26",
  "source_url": "https://example.com/article",
  "source_name": "TechNews",
  "excerpt": "Company X announced laying off 200 customer support staff...",
  "causality": "direct",
  "confidence": 0.85,
  "status": "verified",
  "tolls": {
    "jobs": 200,
    "teams": 3,
    "companies": 1,
    "revenue": null,
    "labor_hours": -416000
  },
  "notes": "Q2 2026 restructuring announcement",
  "created_at": "2026-04-26T06:00:00Z"
}
```

### Daily Rollup (`data/daily_rollup.json`)

```json
{
  "last_updated": "2026-04-26T06:00:00Z",
  "totals": {
    "jobs": 15420,
    "teams": 342,
    "products": 89,
    "companies": 156,
    "revenue": 2400000000,
    "labor_hours": -32000000
  },
  "today": {
    "jobs": 200,
    "teams": 3,
    "products": 0,
    "companies": 1,
    "revenue": 0,
    "labor_hours": -416000
  },
  "events_count": 1247,
  "pending_review": 12
}
```

## Outputs

| File | Description |
|------|-------------|
| `data/events.jsonl` | All verified events (append-only) |
| `data/pending.jsonl` | Events awaiting human review |
| `data/daily_rollup.json` | Aggregated totals for dashboard |
| `reports/daily/YYYY-MM-DD.md` | Daily summary report |

## Usage

### Automated Collection (Daily)

Runs automatically at 6:00 AM UTC via GitHub Actions.

### Manual Trigger

**GitHub UI:**
1. Go to Actions tab
2. Select "Daily AI Toll" workflow
3. Click "Run workflow"

**API:**
```bash
curl -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/Latarence/dailyaitoll/dispatches \
  -d '{"event_type":"collect-toll"}'
```

**Script:**
```bash
GITHUB_TOKEN=ghp_... ./scripts/trigger.sh
```

## Setup

### Prerequisites

- Python 3.11+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- GitHub repository with Actions enabled

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude | Yes |

### GitHub Secrets

Add to repository Settings → Secrets → Actions:

- `ANTHROPIC_API_KEY` — Your Anthropic API key

## Methodology

See [docs/methodology.md](docs/methodology.md) for detailed information on:
- Source selection criteria
- Causality assessment framework
- Confidence scoring rubric
- Review process

## License

MIT

## Links

- **Website:** https://dailyaitoll.com
- **Repository:** https://github.com/Latarence/dailyaitoll
