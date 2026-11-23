// Static check: checkout code must not pin payment_method_types (keeps Stripe Link / dynamic methods available).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
test('no hardcoded payment_method_types in checkout code', () => {
  for (const f of ['create-checkout.js', 'create-data-checkout.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'api', f), 'utf8');
    assert.ok(!/payment_method_types/.test(src), f + ' pins payment_method_types');
  }
});
