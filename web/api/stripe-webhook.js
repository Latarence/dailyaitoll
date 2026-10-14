const crypto = require('crypto');
let kv;
try {
  ({ kv } = require('@vercel/kv'));
} catch {
  kv = null;
}
const { isDisputeEvent, recordDispute, kvConfigured } = require('./_lib/disputes');

// KV is optional storage. It is used only when its env (KV_REST_API_URL + KV_REST_API_TOKEN) is present,
// so a FEATURE_USE_KV_* flag turned on without a store can never turn a paid webhook into a 5xx retry loop.
function kvUsable() {
  return !!kv && kvConfigured();
}

// Verify Stripe webhook signature
function verifyStripeSignature(payload, signature, secret) {
  const elements = signature.split(',');
  const timestamp = elements.find(e => e.startsWith('t=')).split('=')[1];
  const v1Signature = elements.find(e => e.startsWith('v1=')).split('=')[1];

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(v1Signature),
    Buffer.from(expectedSignature)
  );
}

async function recordPatron({ tier, name, url, description, stripeSessionId }) {
  if (!kv) throw new Error('KV not available');
  const dedupeKey = `patron_session:${stripeSessionId}`;
  const first = await kv.setnx(dedupeKey, '1');
  if (!first) return false;

  try {
    const existing =
      (await kv.get('patrons:v1')) || { founding: [], sustainer: [], supporter: [] };

    const entry = { name, url: url || '' };
    if (tier === 'founding') entry.description = description || '';

    const next = {
      founding: existing.founding || [],
      sustainer: existing.sustainer || [],
      supporter: existing.supporter || [],
    };
    if (!next[tier]) return false;
    next[tier] = [entry, ...next[tier]].slice(0, 500);

    await kv.set('patrons:v1', next);
    return true;
  } catch (err) {
    // Release the claim so the fallback (or a Stripe retry) can still record this patron.
    try { await kv.del(dedupeKey); } catch { /* best effort */ }
    throw err;
  }
}

async function recordLicense({ tier, email, stripeSessionId }) {
  if (!kv) throw new Error('KV not available');
  const key = `data_license_session:${stripeSessionId}`;
  await kv.set(key, JSON.stringify({ tier, email: email || '', created_at: new Date().toISOString() }));
  return true;
}

const DISPATCH_URL =
  'https://api.github.com/repos/Latarence/dailyaitoll/actions/workflows/add-patron.yml/dispatches';

// Sends stripe_session_id so add-patron.yml can skip a session it already added (Stripe retries).
// A workflow that does not declare that input yet answers 422 "Unexpected inputs provided"; then the
// dispatch is resent without it, so this code works with both the old and the new workflow.
async function dispatchPatronToGitHub({ tier, name, url, description, stripeSessionId }) {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) throw new Error('Missing GITHUB_TOKEN');

  const base = { tier, name, url: url || '', description: description || '' };
  const send = (inputs) => fetch(DISPATCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs }),
  });

  let response = await send(stripeSessionId ? { ...base, stripe_session_id: stripeSessionId } : base);
  if (!response.ok && stripeSessionId && response.status === 422) {
    const text = await response.text();
    if (!/unexpected inputs/i.test(text)) {
      throw new Error(`GitHub dispatch failed: 422 ${text}`);
    }
    console.log('add-patron.yml has no stripe_session_id input yet; dispatching without it');
    response = await send(base);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub dispatch failed: ${response.status} ${text}`);
  }
}

// Webhook-side dedupe for the GitHub path, only when a KV store is configured (cheap SETNX).
// Without KV the add-patron.yml session-id check is the dedupe. KV errors never block the dispatch.
async function claimDispatch(stripeSessionId) {
  if (!kvUsable() || !stripeSessionId) return { key: null, duplicate: false };
  const key = `patron_dispatch:${stripeSessionId}`;
  try {
    const first = await kv.setnx(key, '1');
    return { key: first ? key : null, duplicate: !first };
  } catch (err) {
    console.error('patron dispatch dedupe unavailable (KV error):', err && err.message);
    return { key: null, duplicate: false };
  }
}

async function releaseDispatch(key) {
  if (!key) return;
  try { await kv.del(key); } catch { /* best effort */ }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return res.status(400).json({ error: 'Missing signature or secret' });
  }

  // Get raw body
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');

  // Verify signature
  try {
    if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  const event = JSON.parse(rawBody);

  // Chargebacks: record charge.dispute.created / .updated / .closed for the operator (no email).
  if (isDisputeEvent(event.type)) {
    try {
      const result = await recordDispute(event, { kv });
      return res.status(200).json({
        received: true, kind: 'dispute', dispute: result.record && result.record.id,
        recorded: result.recorded, duplicate: !!result.duplicate,
      });
    } catch (err) {
      console.error('Error recording dispute:', err && err.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  // Otherwise only handle successful checkout sessions
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, skipped: true });
  }

  const session = event.data.object;
  const metadata = session.metadata || {};

  try {
    const stripeSessionId = session.id;

    const kind = metadata.kind;

    if (kind === 'data_license') {
      const tier = metadata.tier;
      if (!tier) {
        return res.status(400).json({ error: 'Missing license tier' });
      }

      const email = session.customer_details?.email || '';
      // Stripe is the source of truth: /api/data-download re-verifies the session with Stripe,
      // so a missing or failing KV store is logged and never fails the webhook.
      if (process.env.FEATURE_USE_KV_DATA_LICENSES === 'true') {
        if (!kvUsable()) {
          console.error(`LICENSE_ALERT (KV not configured, not stored) session=${stripeSessionId} tier=${tier}`);
        } else {
          try {
            await recordLicense({ tier, email, stripeSessionId });
          } catch (err) {
            console.error(`LICENSE_ALERT (KV write failed, not stored) session=${stripeSessionId} tier=${tier}:`,
              err && err.message);
          }
        }
      }

      console.log(`Data license recorded: ${email || 'unknown'} (${tier})`);
      return res.status(200).json({ success: true, kind, tier });
    }

    // Default: patron
    const tier = metadata.tier;
    const name = metadata.name || session.customer_details?.name;
    const url = metadata.url || '';
    const description = metadata.description || '';

    if (!tier || !name) {
      console.error('Missing tier or name in session metadata');
      return res.status(400).json({ error: 'Missing patron info' });
    }

    let recordedInKv = false;
    if (process.env.FEATURE_USE_KV_PATRONS === 'true') {
      if (!kvUsable()) {
        console.error('PATRON_ALERT (KV not configured): falling back to the GitHub dispatch');
      } else {
        try {
          await recordPatron({ tier, name, url, description, stripeSessionId });
          recordedInKv = true;
        } catch (err) {
          console.error('PATRON_ALERT (KV write failed): falling back to the GitHub dispatch:', err && err.message);
        }
      }
    }

    if (!recordedInKv) {
      const claim = await claimDispatch(stripeSessionId);
      if (claim.duplicate) {
        console.log(`Patron dispatch already sent for this session (${tier}); skipping`);
        return res.status(200).json({ success: true, kind: 'patron', patron: name, tier, duplicate: true });
      }
      try {
        await dispatchPatronToGitHub({ tier, name, url, description, stripeSessionId });
      } catch (err) {
        await releaseDispatch(claim.key);
        throw err;
      }
    }

    console.log(`Patron recorded: ${name} (${tier})`);
    return res.status(200).json({ success: true, kind: 'patron', patron: name, tier });
  } catch (err) {
    console.error('Error recording patron:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
