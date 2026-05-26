const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const TIERS = {
  journalist: { amount: 500, label: 'Journalist / Researcher' },
  commercial: { amount: 5000, label: 'Commercial License' },
};

function getPriceId(tier) {
  if (tier === 'journalist') return process.env.STRIPE_DATA_JOURNALIST_PRICE_ID;
  if (tier === 'commercial') return process.env.STRIPE_DATA_COMMERCIAL_PRICE_ID;
  return undefined;
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tier, email } = req.body || {};
    if (!tier || !TIERS[tier]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    const siteUrl = process.env.SITE_URL || 'https://dailyaitoll.com';
    const priceId = getPriceId(tier);

    const lineItem = priceId
      ? { price: priceId, quantity: 1 }
      : {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Daily AI Toll Dataset - ${TIERS[tier].label}`,
              description: 'Licensed CSV download of the full Daily AI Toll dataset.',
            },
            unit_amount: TIERS[tier].amount,
          },
          quantity: 1,
        };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email || undefined,
      line_items: [lineItem],
      metadata: {
        kind: 'data_license',
        tier,
      },
      success_url: `${siteUrl}/data/success/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/data/`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
