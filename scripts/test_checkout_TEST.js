#!/usr/bin/env node
// TEST-MODE ONLY checkout proof for Daily AI Toll. Refuses any key that is not sk_test_.
// Usage (key injected by purpose, never printed):
//   keys use stripe:mdo3:mdo3-stripe-test-secret-key -- node scripts/test_checkout_TEST.js
// What it proves: each handler (patron x3, data x2) builds a TEST Checkout Session whose amount equals the
// listed price (shown = charged). It does NOT complete payment: open each printed URL in a browser seat and pay
// with 4242 4242 4242 4242 (any future expiry/CVC) to exercise success redirect + webhook (needs its own TEST webhook).
const key = process.env.STRIPE_SECRET_KEY || '';
if (!key.startsWith('sk_test_')) {
  console.error('REFUSED: STRIPE_SECRET_KEY must be a sk_test_ key. This script never runs against live.');
  process.exit(2);
}
process.env.SITE_URL = process.env.SITE_URL || 'https://dailyaitoll.com';
const Stripe = require(require.resolve('stripe', { paths: [__dirname + '/../web'] }));
const stripe = Stripe(key);
const patron = require('../web/api/create-checkout.js');
const data = require('../web/api/create-data-checkout.js');

function call(handler, body) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader() {}, status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); }, end() { resolve({ code: this.code }); } };
    handler({ method: 'POST', body }, res);
  });
}
const terms = { terms_accepted: true, termsAccepted: true };
const cases = [
  [patron, { tier: 'supporter', name: 'TEST Supporter', ...terms }, 2500],
  [patron, { tier: 'sustainer', name: 'TEST Sustainer', ...terms }, 10000],
  [patron, { tier: 'founding', name: 'TEST Founding', description: 'test', ...terms }, 50000],
  [data, { tier: 'journalist', email: 'test@example.com', ...terms }, 500],
  [data, { tier: 'commercial', email: 'test@example.com', ...terms }, 5000],
];
(async () => {
  let bad = 0;
  for (const [h, b, cents] of cases) {
    const r = await call(h, b);
    if (r.code !== 200 || !r.body.url) { console.log('FAIL', b.tier, r.code, JSON.stringify(r.body)); bad++; continue; }
    const id = r.body.url.match(/cs_test_[A-Za-z0-9]+/)?.[0];
    const s = id ? await stripe.checkout.sessions.retrieve(id) : null;
    const ok = s && s.livemode === false && s.amount_total === cents && s.currency === 'usd';
    console.log(ok ? 'PASS' : 'FAIL', b.tier, s ? `${s.amount_total} ${s.currency} livemode=${s.livemode}` : 'no cs_test id', r.body.url);
    if (!ok) bad++;
  }
  process.exit(bad ? 1 : 0);
})();
