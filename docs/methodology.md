# Methodology

## Core Principle

Every toll entry must be traceable to a verifiable source. We do not include:
- Projections or forecasts
- Speculation about future layoffs
- Anonymous reports without corroboration
- AI capability announcements (until actual displacement occurs)

## Source Selection

### Accepted Sources

| Tier | Source Type | Examples | Weight |
|------|-------------|----------|--------|
| 1 | Official announcements | SEC filings, press releases, earnings calls | Highest |
| 2 | Major news outlets | Reuters, Bloomberg, WSJ, NYT | High |
| 3 | Industry publications | TechCrunch, The Verge, Ars Technica | Medium |
| 4 | Verified social media | LinkedIn posts from executives, official accounts | Medium |
| 5 | Local news | Regional outlets covering local layoffs | Lower |

### Excluded Sources

- Anonymous forums (Reddit speculation, Blind without verification)
- Opinion pieces without factual basis
- AI hype articles without concrete displacement data
- Press releases about AI adoption (without job impact data)

## Causality Assessment

Each event is assessed for AI causality:

| Level | Definition | Criteria |
|-------|------------|----------|
| **Direct** | AI explicitly cited as reason | Company states AI as cause |
| **Contributing** | AI mentioned among factors | AI listed with other reasons |
| **Inferred** | Pattern suggests AI involvement | AI tools deployed, roles match AI capabilities |
| **Unclear** | Cannot determine AI role | Restructuring without AI mention |

Only **Direct** and **Contributing** events are included in primary tolls. **Inferred** events are tracked separately.

## Confidence Scoring

Confidence scores (0.0 - 1.0) are assigned based on:

| Factor | Impact |
|--------|--------|
| Source tier | +0.1 to +0.3 |
| Multiple sources | +0.1 per corroborating source |
| Official confirmation | +0.2 |
| Specific numbers provided | +0.1 |
| Vague language ("some", "many") | -0.2 |
| Single anonymous source | -0.3 |

### Thresholds

- **≥ 0.8** — Verified, included in primary totals
- **0.6 - 0.79** — Included with flag
- **0.4 - 0.59** — Pending review
- **< 0.4** — Rejected

## Toll Calculation

### Job Toll

- Count of individual roles eliminated
- Includes: layoffs, position eliminations, hiring freezes for AI-replaced roles
- Excludes: voluntary attrition, retirements, unrelated restructuring

### Team Toll

- Count of teams dissolved, merged, or significantly reduced (>50%)
- One team = organizational unit with shared manager/function

### Product Toll

- Products or services discontinued due to AI alternatives
- Includes: internal tools replaced, customer products sunset

### Company Toll

- Unique companies experiencing AI-driven workforce changes
- Counted once per significant event (not per layoff round)

### Revenue Toll

- Estimated revenue impact when disclosed
- Only official figures; no projections
- Converted to USD at event date rates

### Labor Toll

- Hours = (Jobs affected) × (2080 annual hours)
- Negative = hours reduced
- Positive = new AI-related jobs created
- Net = sum of reductions and creations

## Review Process

1. **Automated collection** — Claude processes sources daily
2. **PR created** — All changes submitted as pull request
3. **Human review** — Maintainer verifies:
   - Source validity
   - Causality assessment accuracy
   - Confidence score appropriateness
   - Number accuracy
4. **Merge or reject** — Approved events merged to main

## Data Corrections

Corrections are handled via:
- New event with `correction_for` field referencing original
- Original event remains (audit trail)
- Rollup recalculated on merge

## Limitations

- **Lag time** — Events may take days/weeks to surface
- **Undercount** — Not all layoffs are publicly reported
- **Attribution** — AI causality not always explicit
- **Global coverage** — English-language sources predominate
- **Private companies** — Less visibility than public companies

## Updates

This methodology may be updated. Changes are tracked in git history.
