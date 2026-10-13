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

async function runDataCheckout(tier, extra = { terms_accepted: true }) {
  const h = fresh('create-data-checkout.js');
  const res = mockRes();
  await h({ method: 'POST', body: { tier, ...extra } }, res);
  return res;
}

// ---------- L-DAT-03 terms consent + L-DAT-04 campaign attribution (both checkouts) ----------
test('data checkout: without terms consent -> 400 and no session', async () => {
  clearEnv();
  const calls = stripeMock(null);
  for (const extra of [{}, { terms_accepted: false }, { terms_accepted: 'true' }]) {
    const res = await runDataCheckout('journalist', extra);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /Terms/);
  }
  assert.strictEqual(calls.sessions.length, 0);
});

test('data checkout: consent recorded as ISO UTC; utm -> metadata + client_reference_id', async () => {
  clearEnv();
  const calls = stripeMock(null);
  const res = await runDataCheckout('journalist', { terms_accepted: true,
    attribution: { utm_source: 'linkedin', utm_campaign: 'launch oct!', ref: 'x'.repeat(400), bogus: 'nope' } });
  assert.strictEqual(res.statusCode, 200);
  const s = calls.sessions[0];
  assert.match(s.metadata.terms_accepted_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(s.metadata.terms_version);
  assert.strictEqual(s.metadata.kind, 'data_license');
  assert.strictEqual(s.metadata.utm_source, 'linkedin');
  assert.strictEqual(s.metadata.utm_campaign, 'launch-oct');
  assert.strictEqual(s.metadata.ref.length, 150);
  assert.ok(!('bogus' in s.metadata));
  assert.match(s.client_reference_id, /^dat_s-linkedin_c-launch-oct_r-x+$/);
  assert.ok(s.client_reference_id.length <= 200);
});

test('data checkout: no campaign tags -> no utm metadata, no client_reference_id', async () => {
  clearEnv();
  const calls = stripeMock(null);
  await runDataCheckout('commercial', { terms_accepted: true, attribution: 'junk' });
  const s = calls.sessions[0];
  assert.strictEqual(s.client_reference_id, undefined);
  assert.deepStrictEqual(Object.keys(s.metadata).sort(), ['kind', 'terms_accepted_at', 'terms_version', 'tier']);
});

test('patron checkout: consent required; recorded with utm', async () => {
  clearEnv();
  const calls = stripeMock(null);
  const h = fresh('create-checkout.js');
  let res = mockRes();
  await h({ method: 'POST', body: { tier: 'supporter', name: 'Jane' } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(calls.sessions.length, 0);
  res = mockRes();
  await h({ method: 'POST', body: { tier: 'supporter', name: 'Jane', terms_accepted: true,
    attribution: { utm_medium: 'email' } } }, res);
  assert.strictEqual(res.statusCode, 200);
  const s = calls.sessions[0];
  assert.strictEqual(s.metadata.kind, 'patron');
  assert.strictEqual(s.metadata.name, 'Jane');
  assert.match(s.metadata.terms_accepted_at, /Z$/);
  assert.strictEqual(s.metadata.utm_medium, 'email');
  assert.strictEqual(s.client_reference_id, 'dat_m-email');
  assert.strictEqual(s.line_items[0].price_data.unit_amount, 2500);
});

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

// ---------- /api/data-download: Blob dataset path (FEATURE_USE_BLOB_DATASET) ----------
const { PassThrough } = require('stream');

function streamRes() {
  const res = new PassThrough();
  Object.assign(res, { statusCode: 0, headers: {}, body: undefined, chunks: [] });
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.end(); return res; };
  res.on('data', (c) => res.chunks.push(c));
  res.done = new Promise((resolve) => res.on('finish', resolve));
  return res;
}

function paidStripe(metadata = { kind: 'data_license', tier: 'journalist' }, payment_status = 'paid') {
  mocks.stripe = () => ({ checkout: { sessions: { retrieve: async () => ({ payment_status, metadata,
    customer_details: { email: 'buyer@example.invalid' } }) } } });
}

const BLOB_URL = 'https://store.public.blob.vercel-storage.example.invalid/datasets/events.csv';
async function runDownload({ blob, fetchImpl, query = { session_id: 'cs_test_1' } }) {
  const calls = { head: [], fetch: [] };
  mocks['@vercel/blob'] = blob === undefined ? {
    head: async (p) => { calls.head.push(p); return { url: BLOB_URL, pathname: p, size: 10 }; },
  } : blob(calls);
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => { calls.fetch.push([url, opts]); return fetchImpl(url); };
  try {
    const h = fresh('data-download.js');
    const res = streamRes();
    await h({ method: 'GET', query }, res);
    await res.done;
    return { res, calls, text: Buffer.concat(res.chunks).toString('utf8') };
  } finally {
    global.fetch = origFetch;
  }
}

test('data download (blob): paid -> head + server-side fetch, CSV streamed, blob URL never exposed', async () => {
  clearEnv();
  process.env.FEATURE_USE_BLOB_DATASET = 'true';
  paidStripe();
  const csv = 'date,model,toll\n2026-10-01,x,1\n';
  const { res, calls, text } = await runDownload({ fetchImpl: async () => new Response(csv) });
  assert.deepStrictEqual(calls.head, ['datasets/events.csv']);
  assert.strictEqual(calls.fetch.length, 1);
  assert.strictEqual(calls.fetch[0][0], BLOB_URL);
  assert.strictEqual(text, csv);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /attachment/);
  assert.ok(!JSON.stringify(res.headers).includes('blob.vercel-storage'), 'no blob URL in headers');
  assert.ok(!res.headers.location, 'no redirect to the blob');
});

test('data download (blob): blob not uploaded (head throws) -> 500 dataset not available, no fetch', async () => {
  clearEnv();
  process.env.FEATURE_USE_BLOB_DATASET = 'true';
  paidStripe();
  const { res, calls } = await runDownload({
    blob: () => ({ head: async () => { throw new Error('The requested blob does not exist'); } }),
    fetchImpl: async () => new Response('x'),
  });
  assert.deepStrictEqual([res.statusCode, res.body], [500, { error: 'Dataset not available yet' }]);
  assert.strictEqual(calls.fetch.length, 0);
});

test('data download (blob): blob fetch fails -> 500 dataset not available', async () => {
  clearEnv();
  process.env.FEATURE_USE_BLOB_DATASET = 'true';
  paidStripe();
  const { res } = await runDownload({ fetchImpl: async () => new Response('nope', { status: 404 }) });
  assert.deepStrictEqual([res.statusCode, res.body], [500, { error: 'Dataset not available yet' }]);
});

test('data download (blob): @vercel/blob without head -> 500 Blob not available', async () => {
  clearEnv();
  process.env.FEATURE_USE_BLOB_DATASET = 'true';
  paidStripe();
  const { res } = await runDownload({ blob: () => ({}), fetchImpl: async () => new Response('x') });
  assert.deepStrictEqual([res.statusCode, res.body], [500, { error: 'Blob not available' }]);
});

test('data download (blob): unpaid or non-license session -> 403, blob never touched', async () => {
  clearEnv();
  process.env.FEATURE_USE_BLOB_DATASET = 'true';
  paidStripe({ kind: 'data_license', tier: 'journalist' }, 'unpaid');
  let r = await runDownload({ fetchImpl: async () => new Response('x') });
  assert.strictEqual(r.res.statusCode, 403);
  assert.deepStrictEqual([r.calls.head.length, r.calls.fetch.length], [0, 0]);
  paidStripe({ kind: 'patron', tier: 'x' });
  r = await runDownload({ fetchImpl: async () => new Response('x') });
  assert.strictEqual(r.res.statusCode, 403);
  assert.deepStrictEqual([r.calls.head.length, r.calls.fetch.length], [0, 0]);
});

test('data download: flag off -> bundled CSV path, Blob never touched', async () => {
  clearEnv();
  paidStripe();
  const { res, calls, text } = await runDownload({ fetchImpl: async () => new Response('x') });
  assert.deepStrictEqual([calls.head.length, calls.fetch.length], [0, 0]);
  const bundled = path.join(API, '_data', 'events.csv');
  if (require('fs').existsSync(bundled)) {
    assert.strictEqual(text, require('fs').readFileSync(bundled, 'utf8'));
  } else {
    assert.deepStrictEqual([res.statusCode, res.body], [500, { error: 'Dataset not available yet' }]);
  }
});

test('data download: missing session_id -> 400; POST -> 405', async () => {
  clearEnv();
  paidStripe();
  let r = await runDownload({ fetchImpl: async () => new Response('x'), query: {} });
  assert.strictEqual(r.res.statusCode, 400);
  const h = fresh('data-download.js');
  const res = streamRes();
  await h({ method: 'POST', query: {} }, res);
  assert.strictEqual(res.statusCode, 405);
});
