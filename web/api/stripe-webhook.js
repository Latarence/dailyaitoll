const crypto = require('crypto');

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const githubToken = process.env.GITHUB_TOKEN;

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

  // Extract patron info from metadata
  const tier = metadata.tier;
  const name = metadata.name || session.customer_details?.name;
  const url = metadata.url || '';
  const description = metadata.description || '';

  if (!tier || !name) {
    console.error('Missing tier or name in session metadata');
    return res.status(400).json({ error: 'Missing patron info' });
  }

  // Trigger GitHub Actions workflow
  try {
    const response = await fetch(
      'https://api.github.com/repos/Latarence/dailyaitoll/actions/workflows/add-patron.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            tier,
            name,
            url,
            description,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('GitHub API error:', error);
      return res.status(500).json({ error: 'Failed to trigger workflow' });
    }

    console.log(`Patron added: ${name} (${tier})`);
    return res.status(200).json({ success: true, patron: name, tier });
  } catch (err) {
    console.error('Error triggering workflow:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
