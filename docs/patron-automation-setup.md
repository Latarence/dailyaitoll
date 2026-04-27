# Patron Automation Setup

This document explains how to set up automated patron updates when someone pays via Stripe.

## Flow

1. User clicks payment link on `/patrons/`
2. User completes Stripe Checkout
3. Stripe sends webhook to `/api/stripe-webhook`
4. Webhook triggers GitHub Actions `add-patron.yml`
5. GitHub Action updates `patrons.json` and commits

## Setup Steps

### 1. Vercel Environment Variables

Add these in Vercel Dashboard > Project Settings > Environment Variables:

| Variable | Description |
|----------|-------------|
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from Stripe (starts with `whsec_`) |
| `GITHUB_TOKEN` | GitHub PAT with `repo` and `workflow` permissions |

### 2. Stripe Webhook

1. Go to [Stripe Dashboard > Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. Endpoint URL: `https://dailyaitoll.com/api/stripe-webhook`
4. Events to send: `checkout.session.completed`
5. Copy the signing secret to Vercel env vars

### 3. Stripe Payment Links Metadata

Edit each payment link in [Stripe Dashboard > Payment Links](https://dashboard.stripe.com/payment-links):

**Supporter ($25)**
- Add metadata: `tier` = `supporter`

**Sustainer ($100)**
- Add metadata: `tier` = `sustainer`

**Founding Patron ($500)**
- Add metadata: `tier` = `founding`

For all links, also:
- Enable "Collect customers' names" in Checkout settings
- Optionally add custom field for "url" (sustainer/founding)
- Optionally add custom field for "description" (founding only)

### 4. GitHub Token

Create a Personal Access Token:
1. Go to GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens
2. Create token with:
   - Repository access: `Latarence/dailyaitoll`
   - Permissions: `Actions: Read and write`, `Contents: Read`
3. Add to Vercel env vars as `GITHUB_TOKEN`

## Testing

1. Use Stripe test mode
2. Make a test payment
3. Check Vercel function logs
4. Verify `patrons.json` was updated

## Troubleshooting

- Check Vercel function logs in dashboard
- Check Stripe webhook delivery logs
- Verify GitHub Action ran successfully
