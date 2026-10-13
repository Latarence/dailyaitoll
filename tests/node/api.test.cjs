// Unit tests for web/api functions with stripe / @vercel/kv / @vercel/blob mocked. No network, no Stripe.
// Run: node --test tests/node/*.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');

const API = path.join(__dirname, '..', '..', 'web', 'api');
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

const ENV_KEYS = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'FEATURE_USE_KV_PATRONS',
  'FEATURE_USE_KV_DATA_LICENSES', 'FEATURE_USE_BLOB_DATASET', 'VERCEL_GIT_COMMIT_SHA',
  'STRIPE_SECRET_KEY', 'STRIPE_DATA_JOURNALIST_PRICE_ID', 'STRIPE_DATA_COMMERCIAL_PRICE_ID'];
function clearEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

// ---------- /api/health ----------
test('health: KV not required, not configured -> 200, kv unreachable, no secrets', async () => {
  clearEnv();
  mocks['@vercel/kv'] = { kv: { ping: async () => 'PONG' } };
  const { makeHandler } = fresh('health.js');
  const res = mockRes();
  await makeHandler({})({ method: 'GET' }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.kv, 'unreachable');
  assert.strictEqual(res.body.kv_required, false);
  assert.strictEqual(res.body.blob, 'not_used');
  assert.ok('built_at' in res.body && 'commit' in res.body);
  assert.strictEqual(res.headers['cache-control'], 'no-store');
});

test('health: KV required and reachable -> 200', async () => {
  clearEnv();
  Object.assign(process.env, { KV_REST_API_URL: 'https://kv.example.invalid', KV_REST_API_TOKEN: 'sekrit-token',
    FEATURE_USE_KV_PATRONS: 'true', VERCEL_GIT_COMMIT_SHA: 'abc123' });
  const { makeHandler } = fresh('health.js');
  const res = mockRes();
  await makeHandler({ kv: { ping: async () => 'PONG' } })({ method: 'GET' }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual([res.body.ok, res.body.kv, res.body.kv_required, res.body.commit], [true, 'reachable', true, 'abc123']);
  const s = JSON.stringify(res.body);
  assert.ok(!s.includes('sekrit') && !s.includes('kv.example'), 'no env values in body');
});

test('health: KV required and down -> 503', async () => {
  clearEnv();
  Object.assign(process.env, { KV_REST_API_URL: 'https://kv.example.invalid', KV_REST_API_TOKEN: 't',
    FEATURE_USE_KV_DATA_LICENSES: 'true' });
  const { makeHandler } = fresh('health.js');
  const res = mockRes();
  await makeHandler({ kv: { ping: async () => { throw new Error('ECONNREFUSED'); } } })({ method: 'GET' }, res);
  assert.strictEqual(res.statusCode, 503);
  assert.deepStrictEqual([res.body.ok, res.body.kv], [false, 'unreachable']);
});

test('health: KV required, ping hangs -> 503 after timeout', async () => {
  clearEnv();
  Object.assign(process.env, { KV_REST_API_URL: 'u', KV_REST_API_TOKEN: 't', FEATURE_USE_KV_PATRONS: 'true' });
  const { makeHandler } = fresh('health.js');
  const res = mockRes();
  await makeHandler({ timeoutMs: 50, kv: { ping: () => new Promise(() => {}) } })({ method: 'GET' }, res);
  assert.strictEqual(res.statusCode, 503);
});

test('health: KV required but not configured -> 503', async () => {
  clearEnv();
  process.env.FEATURE_USE_KV_PATRONS = 'true';
  const { makeHandler } = fresh('health.js');
  const res = mockRes();
  await makeHandler({ kv: { ping: async () => 'PONG' } })({ method: 'GET' }, res);
  assert.strictEqual(res.statusCode, 503);
});

test('health: Blob dataset required and missing -> 503; present -> 200', async () => {
  clearEnv();
  Object.assign(process.env, { FEATURE_USE_BLOB_DATASET: 'true', BLOB_READ_WRITE_TOKEN: 't' });
  const { makeHandler } = fresh('health.js');
  let res = mockRes();
  await makeHandler({ blobHead: async () => { throw new Error('BlobNotFoundError'); } })({ method: 'GET' }, res);
  assert.deepStrictEqual([res.statusCode, res.body.blob, res.body.blob_required], [503, 'unreachable', true]);
  res = mockRes();
  await makeHandler({ blobHead: async () => ({ size: 1 }) })({ method: 'GET' }, res);
  assert.deepStrictEqual([res.statusCode, res.body.blob], [200, 'reachable']);
});

test('health: POST -> 405', async () => {
  clearEnv();
  const { makeHandler } = fresh('health.js');
  const res = mockRes();
  await makeHandler({})({ method: 'POST' }, res);
  assert.strictEqual(res.statusCode, 405);
});

// ---------- data checkout: shown = charged ----------
function stripeMock(priceObj) {
  const calls = { sessions: [] };
  const client = {
    prices: { retrieve: async () => { if (priceObj instanceof Error) throw priceObj; return priceObj; } },
    checkout: { sessions: { create: async (p) => { calls.sessions.push(p); return { url: 'https://checkout.example.invalid/s' }; } } },
  };
  mocks.stripe = () => client;
  return calls;
}

async function runDataCheckout(tier) {
  const h = fresh('create-data-checkout.js');
  const res = mockRes();
  await h({ method: 'POST', body: { tier } }, res);
  return res;
}

test('data checkout: no price id -> inline amount equals listed amount', async () => {
  clearEnv();
  const calls = stripeMock(null);
  const res = await runDataCheckout('journalist');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.sessions[0].line_items[0].price_data.unit_amount, 500);
});

test('data checkout: matching price id is used', async () => {
  clearEnv();
  process.env.STRIPE_DATA_COMMERCIAL_PRICE_ID = 'price_ok';
  const calls = stripeMock({ id: 'price_ok', active: true, currency: 'usd', unit_amount: 5000 });
  await runDataCheckout('commercial');
  assert.deepStrictEqual(calls.sessions[0].line_items[0], { price: 'price_ok', quantity: 1 });
});

test('data checkout: mismatched or unreadable price id falls back to listed amount', async () => {
  clearEnv();
  process.env.STRIPE_DATA_COMMERCIAL_PRICE_ID = 'price_bad';
  let calls = stripeMock({ id: 'price_bad', active: true, currency: 'usd', unit_amount: 9900 });
  await runDataCheckout('commercial');
  assert.strictEqual(calls.sessions[0].line_items[0].price_data.unit_amount, 5000);
  calls = stripeMock(new Error('No such price'));
  await runDataCheckout('commercial');
  assert.strictEqual(calls.sessions[0].line_items[0].price_data.unit_amount, 5000);
});
