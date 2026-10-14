// R-dailyaitoll-2: /api/stripe-webhook records charge.dispute.* events. Stripe and @vercel/kv are stubbed:
// no network, no Stripe. Run: node --test tests/node/*.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const Module = require('module');
const path = require('path');
const { Readable } = require('stream');

const API = path.join(__dirname, '..', '..', 'web', 'api');
const SECRET = 'whsec_test_dummy_not_a_real_secret';
const mocks = {};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
  return origLoad.apply(this, arguments);
};

function fresh(file) {
  const p = path.join(API, file);
  delete require.cache[require.resolve(p)];
  return require(p);
}

function mockRes() {
  const res = { statusCode: 0, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

// In-memory stand-in for the @vercel/kv client (only the calls the API uses).
function fakeKv() {
  const store = new Map();
  const hashes = new Map();
  const calls = [];
  const kv = {
    calls, store, hashes,
    ping: async () => 'PONG',
    get: async (k) => { calls.push(['get', k]); return store.has(k) ? store.get(k) : null; },
    set: async (k, v) => { calls.push(['set', k]); store.set(k, v); return 'OK'; },
    setnx: async (k, v) => { calls.push(['setnx', k]); if (store.has(k)) return 0; store.set(k, v); return 1; },
    hget: async (k, f) => { calls.push(['hget', k, f]); const h = hashes.get(k); return h && h[f] !== undefined ? h[f] : null; },
    hset: async (k, obj) => { calls.push(['hset', k]); hashes.set(k, { ...(hashes.get(k) || {}), ...obj }); return 1; },
    hgetall: async (k) => { calls.push(['hgetall', k]); return hashes.get(k) || null; },
  };
  return kv;
}

function sign(raw, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

function setEnv({ kv = true } = {}) {
  for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'FEATURE_USE_KV_PATRONS', 'FEATURE_USE_KV_DATA_LICENSES',
    'FEATURE_USE_BLOB_DATASET', 'GITHUB_TOKEN']) delete process.env[k];
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  if (kv) Object.assign(process.env, { KV_REST_API_URL: 'https://kv.example.invalid', KV_REST_API_TOKEN: 't' });
}

async function deliver(event, { signature, kv } = {}) {
  mocks['@vercel/kv'] = { kv };
  mocks.stripe = () => { throw new Error('Stripe API must not be called by the webhook'); };
  const handler = fresh('stripe-webhook.js');
  const raw = JSON.stringify(event);
  const req = Readable.from([Buffer.from(raw)]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': signature === undefined ? sign(raw) : signature };
  const res = mockRes();
  await handler(req, res);
  return res;
}

function disputeEvent(type, { evtId, status, created = 1760000000, amount = 2500, reason = 'fraudulent' } = {}) {
  return {
    id: evtId || `evt_${type}_${status}`, type, created,
    data: { object: { id: 'dp_test_1', object: 'dispute', amount, currency: 'usd', reason, status,
      charge: 'ch_test_1', payment_intent: 'pi_test_1', created: 1759990000, livemode: false,
      evidence_details: { due_by: 1760900000 } } },
  };
}

function stored(kv, id = 'dp_test_1') {
  const raw = (kv.hashes.get('disputes:v1') || {})[id];
  return raw ? JSON.parse(raw) : null;
}

test('dispute created -> 200 and recorded with id, amount, reason, status, charge, created', async () => {
  setEnv();
  const kv = fakeKv();
  const res = await deliver(disputeEvent('charge.dispute.created', { status: 'needs_response' }), { kv });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual([res.body.kind, res.body.dispute, res.body.recorded], ['dispute', 'dp_test_1', true]);
  const r = stored(kv);
  assert.deepStrictEqual(
    [r.id, r.amount, r.currency, r.reason, r.status, r.charge, r.created, r.open],
    ['dp_test_1', 2500, 'usd', 'fraudulent', 'needs_response', 'ch_test_1', new Date(1759990000 * 1000).toISOString(), true]);
  assert.strictEqual(r.evidence_due_by, new Date(1760900000 * 1000).toISOString());
  assert.strictEqual(r.history.length, 1);
  // Purchase stores untouched.
  assert.ok(!kv.calls.some(([op, k]) => op === 'set' || op === 'setnx' || k === 'patrons:v1'));
});

test('dispute updated then closed -> same record, latest status, full history', async () => {
  setEnv();
  const kv = fakeKv();
  await deliver(disputeEvent('charge.dispute.created', { status: 'needs_response', created: 100 }), { kv });
  let res = await deliver(disputeEvent('charge.dispute.updated', { status: 'under_review', created: 200 }), { kv });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(stored(kv).status, 'under_review');
  res = await deliver(disputeEvent('charge.dispute.closed', { status: 'won', created: 300 }), { kv });
  assert.strictEqual(res.statusCode, 200);
  const r = stored(kv);
  assert.deepStrictEqual([r.status, r.open, r.last_event_type], ['won', false, 'charge.dispute.closed']);
  assert.deepStrictEqual(r.history.map((h) => h.status), ['needs_response', 'under_review', 'won']);
  assert.strictEqual(Object.keys(kv.hashes.get('disputes:v1')).length, 1);
});

test('dispute closed with status lost is recorded', async () => {
  setEnv();
  const kv = fakeKv();
  const res = await deliver(disputeEvent('charge.dispute.closed', { status: 'lost' }), { kv });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual([stored(kv).status, stored(kv).open], ['lost', false]);
});

test('dispute: Stripe retry of the same event is idempotent; older event does not regress status', async () => {
  setEnv();
  const kv = fakeKv();
  const closed = disputeEvent('charge.dispute.closed', { status: 'won', created: 300 });
  await deliver(closed, { kv });
  let res = await deliver(closed, { kv });
  assert.deepStrictEqual([res.statusCode, res.body.duplicate], [200, true]);
  assert.strictEqual(stored(kv).history.length, 1);
  res = await deliver(disputeEvent('charge.dispute.updated', { status: 'under_review', created: 200 }), { kv });
  assert.strictEqual(res.statusCode, 200);
  const r = stored(kv);
  assert.strictEqual(r.status, 'won');
  assert.strictEqual(r.history.length, 2);
});

test('dispute without KV configured -> 200, DISPUTE_ALERT logged, nothing stored', async () => {
  setEnv({ kv: false });
  const kv = fakeKv();
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const res = await deliver(disputeEvent('charge.dispute.created', { status: 'needs_response' }), { kv });
    assert.deepStrictEqual([res.statusCode, res.body.recorded], [200, false]);
  } finally {
    console.error = orig;
  }
  assert.ok(logged.some((l) => l.includes('DISPUTE_ALERT') && l.includes('dp_test_1')));
  assert.strictEqual(kv.calls.length, 0);
});

test('dispute with KV configured but write failing -> 500 so Stripe retries', async () => {
  setEnv();
  const kv = fakeKv();
  kv.hset = async () => { throw new Error('ECONNREFUSED'); };
  const orig = console.error;
  console.error = () => {};
  try {
    const res = await deliver(disputeEvent('charge.dispute.created', { status: 'needs_response' }), { kv });
    assert.strictEqual(res.statusCode, 500);
  } finally {
    console.error = orig;
  }
});

test('unrelated events are ignored: 200 skipped, no KV access', async () => {
  setEnv();
  for (const type of ['charge.refunded', 'payment_intent.succeeded', 'charge.dispute.funds_withdrawn', 'invoice.paid']) {
    const kv = fakeKv();
    const res = await deliver({ id: 'evt_x', type, created: 1, data: { object: { id: 'obj_1' } } }, { kv });
    assert.deepStrictEqual([res.statusCode, res.body], [200, { received: true, skipped: true }], type);
    assert.strictEqual(kv.calls.length, 0, type);
  }
});

test('bad signature -> 400 and nothing recorded', async () => {
  setEnv();
  const event = disputeEvent('charge.dispute.created', { status: 'needs_response' });
  const raw = JSON.stringify(event);
  for (const signature of [sign(raw, 'whsec_wrong'), 't=1,v1=deadbeef', 'garbage', '']) {
    const kv = fakeKv();
    const res = await deliver(event, { kv, signature });
    assert.strictEqual(res.statusCode, 400, `signature ${JSON.stringify(signature)}`);
    assert.strictEqual(kv.calls.length, 0);
  }
});

test('missing webhook secret -> 400', async () => {
  setEnv();
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const kv = fakeKv();
  const res = await deliver(disputeEvent('charge.dispute.created', { status: 'needs_response' }), { kv, signature: 't=1,v1=ab' });
  assert.strictEqual(res.statusCode, 400);
});

test('checkout.session.completed (patron, KV flag on) still processed unchanged', async () => {
  setEnv();
  process.env.FEATURE_USE_KV_PATRONS = 'true';
  const kv = fakeKv();
  const res = await deliver({ id: 'evt_c', type: 'checkout.session.completed', created: 1, data: { object: {
    id: 'cs_test_1', metadata: { kind: 'patron', tier: 'supporter', name: 'Jane', url: '' }, customer_details: {} } } }, { kv });
  assert.deepStrictEqual([res.statusCode, res.body.kind, res.body.patron], [200, 'patron', 'Jane']);
  assert.strictEqual(kv.store.get('patrons:v1').supporter[0].name, 'Jane');
  assert.ok(!kv.hashes.has('disputes:v1'));
});

test('health: reports dispute counts (open vs total) without detail; null when KV unreachable', async () => {
  setEnv();
  const kv = fakeKv();
  await deliver(disputeEvent('charge.dispute.created', { status: 'needs_response' }), { kv });
  await deliver({ ...disputeEvent('charge.dispute.closed', { status: 'lost' }),
    data: { object: { ...disputeEvent('x', {}).data.object, id: 'dp_test_2', status: 'lost' } } }, { kv });
  const { makeHandler } = fresh('health.js');
  let res = mockRes();
  await makeHandler({ kv })({ method: 'GET' }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual([res.body.disputes.total, res.body.disputes.open], [2, 1]);
  assert.ok(!JSON.stringify(res.body).includes('ch_test_1'), 'no charge ids in health');
  res = mockRes();
  await makeHandler({ kv: { ping: async () => { throw new Error('down'); } } })({ method: 'GET' }, res);
  assert.strictEqual(res.body.disputes, null);
});
