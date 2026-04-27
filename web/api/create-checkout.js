const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  supporter: 2500,    // $25
  sustainer: 10000,   // $100
  founding: 50000,    // $500
};

const TIER_NAMES = {
  supporter: 'Supporter',
  sustainer: 'Sustainer',
  founding: 'Founding Patron',
};

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
    const { tier, name, url, description } = req.body;

    if (!tier || !name) {
      return res.status(400).json({ error: 'Missing required fields: tier and name' });
    }

    if (!PRICES[tier]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    // Validate description length for founding patrons
    if (tier === 'founding' && description && description.split(/\s+/).length > 250) {
      return res.status(400).json({ error: 'Description exceeds 250 words' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Daily AI Toll - ${TIER_NAMES[tier]}`,
              description: `Thank you for supporting Daily AI Toll as a ${TIER_NAMES[tier]}.`,
            },
            unit_amount: PRICES[tier],
          },
          quantity: 1,
        },
      ],
      metadata: {
        tier,
        name,
        url: url || '',
        description: description || '',
      },
      success_url: `${process.env.SITE_URL || 'https://dailyaitoll.com'}/patrons/thank-you/`,
      cancel_url: `${process.env.SITE_URL || 'https://dailyaitoll.com'}/patrons/`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
