const crypto = require('crypto');
let kv;
try {
  ({ kv } = require('@vercel/kv'));
} catch {
  kv = null;
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
}

async function recordLicense({ tier, email, stripeSessionId }) {
  if (!kv) throw new Error('KV not available');
  const key = `data_license_session:${stripeSessionId}`;
  await kv.set(key, JSON.stringify({ tier, email: email || '', created_at: new Date().toISOString() }));
  return true;
}

async function dispatchPatronToGitHub({ tier, name, url, description }) {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) throw new Error('Missing GITHUB_TOKEN');

  const response = await fetch(
    'https://api.github.com/repos/Latarence/dailyaitoll/actions/workflows/add-patron.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { tier, name, url: url || '', description: description || '' },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub dispatch failed: ${response.status} ${text}`);
  }
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

  // Only handle successful checkout sessions
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
      if (process.env.FEATURE_USE_KV_DATA_LICENSES === 'true') {
        await recordLicense({ tier, email, stripeSessionId });
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

    if (process.env.FEATURE_USE_KV_PATRONS === 'true') {
      await recordPatron({ tier, name, url, description, stripeSessionId });
    } else {
      await dispatchPatronToGitHub({ tier, name, url, description });
    }

    console.log(`Patron recorded: ${name} (${tier})`);
    return res.status(200).json({ success: true, kind: 'patron', patron: name, tier });
  } catch (err) {
    console.error('Error recording patron:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
