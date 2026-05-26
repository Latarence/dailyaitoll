const crypto = require('crypto');
const { sql } = require('@vercel/postgres');

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

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS patrons (
      id BIGSERIAL PRIMARY KEY,
      tier TEXT NOT NULL CHECK (tier IN ('supporter', 'sustainer', 'founding')),
      name TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      stripe_session_id TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS data_licenses (
      id BIGSERIAL PRIMARY KEY,
      tier TEXT NOT NULL CHECK (tier IN ('journalist', 'commercial')),
      email TEXT NOT NULL DEFAULT '',
      stripe_session_id TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
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
    await ensureSchema();

    const stripeSessionId = session.id;

    const kind = metadata.kind;

    if (kind === 'data_license') {
      const tier = metadata.tier;
      if (!tier) {
        return res.status(400).json({ error: 'Missing license tier' });
      }

      const email = session.customer_details?.email || '';
      await sql`
        INSERT INTO data_licenses (tier, email, stripe_session_id)
        VALUES (${tier}, ${email}, ${stripeSessionId})
        ON CONFLICT (stripe_session_id)
        DO NOTHING;
      `;

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

    await sql`
      INSERT INTO patrons (tier, name, url, description, stripe_session_id)
      VALUES (${tier}, ${name}, ${url}, ${description}, ${stripeSessionId})
      ON CONFLICT (stripe_session_id)
      DO NOTHING;
    `;

    console.log(`Patron recorded: ${name} (${tier})`);
    return res.status(200).json({ success: true, kind: 'patron', patron: name, tier });
  } catch (err) {
    console.error('Error recording patron:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
