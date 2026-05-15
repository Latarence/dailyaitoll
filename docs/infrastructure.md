# Infrastructure

## Deployment

| Component | Status | Details |
|-----------|--------|---------|
| Domain | ✅ Active | dailyaitoll.com (GoDaddy → Cloudflare) |
| DNS | ✅ Active | Cloudflare zone `53666f866ac83f42b8ab6f5e65117a0e` |
| Hosting | ✅ Active | Vercel project `dailyaitoll` under Latarence account |
| Vercel Project ID | `prj_UV8D8Z2gnT4hCHFEHGcbszQuh1fc` | vercel.com/latarences-projects/dailyaitoll |
| GitHub | ✅ Active | https://github.com/Latarence/dailyaitoll |
| Actions | ✅ Configured | Cron at 11:55 PM EDT (03:55 UTC) |

## Service URLs

| Service | URL |
|---------|-----|
| Live Site | https://dailyaitoll.com |
| Vercel Dashboard | https://vercel.com/latarences-projects/dailyaitoll |
| GitHub Repo | https://github.com/Latarence/dailyaitoll |

## GitHub Actions

### Daily AI Toll Workflow

- **File:** `.github/workflows/daily-toll.yml`
- **Schedule:** 11:55 PM EDT daily (03:55 UTC)
- **Behavior:** Collects AI displacement events, auto-commits to main
- **Manual trigger:** Workflow dispatch with `create_pr` option

### Other Workflows

| Workflow | File | Purpose |
|----------|------|---------|
| Generate Daily Pages | `generate-daily-pages.yml` | Regenerates daily report pages |
| Health Check | `health-check.yml` | Weekly validation of API config |
| Tests | `test.yml` | Runs test suite on push |

## Stripe Integration

Stripe handles patronage payments via payment links.

### Payment Links

| Product | Price | URL |
|---------|-------|-----|
| Journalist | $5/mo | https://buy.stripe.com/7sY28qfVC7694u83NF8k80x |
| Commercial | $50/mo | https://buy.stripe.com/6oUcN49xegGJ1hW2JB8k80y |

### Environment Variables (Vercel)

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe API for webhook verification |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |

### Stripe Account

- **Account:** MDO3 (mdo3group@gmail.com)
- **Type:** Uses payment links (no live keys in frontend code)

## API Keys

### Collection Script

Script supports both AI providers (uses whichever is available):

| Provider | GitHub Secret | Source |
|----------|---------------|--------|
| Anthropic | `ANTHROPIC_API_KEY` | See API_Tokens_Fillout.md |
| OpenAI | `OPENAI_API_KEY` | MDO3 account |

**Priority:** Anthropic first, falls back to OpenAI if not configured.

## Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| Vercel not auto-deploying on push | MEDIUM | github-actions[bot] pushes not triggering deploys |

### Troubleshooting Vercel Auto-Deploy

If Vercel is not auto-deploying:

1. Check Vercel Git settings: https://vercel.com/latarences-projects/dailyaitoll/settings/git
2. Verify "Ignored Git Bot Commits" is not enabled
3. Confirm branch filter is set to `main`
4. Check for deployment freeze/pause active

## Local Development

```bash
# Run collection locally
cd /Users/latarencebutts/mdo3d/projects/dailyaitoll
python scripts/run_toll.py

# View site locally
cd web && python -m http.server 8000

# Manual trigger workflow
GITHUB_TOKEN=ghp_... ./scripts/trigger.sh
```
