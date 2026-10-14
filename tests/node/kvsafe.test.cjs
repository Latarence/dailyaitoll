// KV-safe paid paths: a FEATURE_USE_KV_* flag turned on without a KV store (or with a failing one) must never
// cost a paying buyer anything. Stripe, @vercel/kv and the GitHub API are stubbed: no network, no Stripe.
// Run: node --test tests/node/*.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const { Readable, PassThrough } = require('stream');

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

// @vercel/kv stand-in. `throwing` mimics the real client with no env (every call throws).
function fakeKv({ throwing = false } = {}) {
  const store = new Map();
  const calls = [];
  const op = (name, fn) => async (...a) => {
    calls.push([name, a[0]]);
    if (throwing) throw new Error('@vercel/kv: Missing required environment variables KV_REST_API_URL');
    return fn(...a);
  };
  return {
    calls, store,
    get: op('get', (k) => (store.has(k) ? store.get(k) : null)),
    set: op('set', (k, v) => { store.set(k, v); return 'OK'; }),
    setnx: op('setnx', (k, v) => { if (store.has(k)) return 0; store.set(k, v); return 1; }),
    del: op('del', (k) => (store.delete(k) ? 1 : 0)),
  };
}

const ENV_KEYS = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'FEATURE_USE_KV_PATRONS', 'FEATURE_USE_KV_DATA_LICENSES',
  'FEATURE_USE_BLOB_DATASET', 'GITHUB_TOKEN', 'STRIPE_SECRET_KEY'];
function setEnv({ kvEnv = false, flags = true } = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.GITHUB_TOKEN = 'ghp_dummy_not_real';
  if (flags) Object.assign(process.env, { FEATURE_USE_KV_PATRONS: 'true', FEATURE_USE_KV_DATA_LICENSES: 'true' });
  if (kvEnv) Object.assign(process.env, { KV_REST_API_URL: 'https://kv.example.invalid', KV_REST_API_TOKEN: 't' });
}

function sign(raw) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}`;
}

// GitHub dispatch stub. `responder(body)` returns a Response; default 204.
function stubGitHub(responder = () => new Response(null, { status: 204 })) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body, auth: opts.headers.Authorization });
    return responder(body, calls.length);
  };
  return { calls, restore: () => { global.fetch = orig; } };
}

async function deliver(event, kv) {
  mocks['@vercel/kv'] = { kv };
  mocks.stripe = () => { throw new Error('Stripe API must not be called by the webhook'); };
  const handler = fresh('stripe-webhook.js');
  const raw = JSON.stringify(event);
  const req = Readable.from([Buffer.from(raw)]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': sign(raw) };
  const res = mockRes();
  await handler(req, res);
  return res;
}

function checkoutEvent(metadata, { sessionId = 'cs_test_kvsafe_1', evtId = 'evt_test_1' } = {}) {
  return { id: evtId, type: 'checkout.session.completed',
    data: { object: { id: sessionId, metadata, customer_details: { email: 'buyer@example.invalid', name: 'Jane' } } } };
}
const LICENSE = { kind: 'data_license', tier: 'journalist' };
const PATRON = { kind: 'patron', tier: 'supporter', name: 'Jane' };

// ---------- webhook: data license ----------
test('webhook license: flags on, no KV env -> 200, KV untouched, no GitHub call', async () => {
  setEnv();
  const kv = fakeKv({ throwing: true });
  const gh = stubGitHub();
  try {
    const res = await deliver(checkoutEvent(LICENSE), kv);
    assert.deepStrictEqual([res.statusCode, res.body.kind, res.body.tier], [200, 'data_license', 'journalist']);
    assert.strictEqual(kv.calls.length, 0);
    assert.strictEqual(gh.calls.length, 0);
  } finally { gh.restore(); }
});

test('webhook license: flags on, @vercel/kv absent -> 200', async () => {
  setEnv({ kvEnv: true });
  const res = await deliver(checkoutEvent(LICENSE), null);
  assert.strictEqual(res.statusCode, 200);
});

test('webhook license: KV configured but write throws -> still 200', async () => {
  setEnv({ kvEnv: true });
  const kv = fakeKv({ throwing: true });
  const res = await deliver(checkoutEvent(LICENSE), kv);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(kv.calls.map((c) => c[0]), ['set']);
});

test('webhook license: KV configured and healthy -> recorded', async () => {
  setEnv({ kvEnv: true });
  const kv = fakeKv();
  const res = await deliver(checkoutEvent(LICENSE), kv);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(kv.store.has('data_license_session:cs_test_kvsafe_1'));
});

// ---------- webhook: patron ----------
test('webhook patron: flags on, no KV env -> GitHub dispatch with session id, 200', async () => {
  setEnv();
  const kv = fakeKv({ throwing: true });
  const gh = stubGitHub();
  try {
    const res = await deliver(checkoutEvent(PATRON), kv);
    assert.deepStrictEqual([res.statusCode, res.body.kind, res.body.patron], [200, 'patron', 'Jane']);
    assert.strictEqual(kv.calls.length, 0, 'KV never touched without its env');
    assert.strictEqual(gh.calls.length, 1);
    assert.match(gh.calls[0].url, /add-patron\.yml\/dispatches$/);
    assert.deepStrictEqual(gh.calls[0].body, { ref: 'main', inputs: { tier: 'supporter', name: 'Jane', url: '',
      description: '', stripe_session_id: 'cs_test_kvsafe_1' } });
  } finally { gh.restore(); }
});

test('webhook patron: flags off (production today) -> dispatch includes session id', async () => {
  setEnv({ flags: false });
  const gh = stubGitHub();
  try {
    const res = await deliver(checkoutEvent(PATRON), null);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(gh.calls[0].body.inputs.stripe_session_id, 'cs_test_kvsafe_1');
  } finally { gh.restore(); }
});

test('webhook patron: old workflow rejects the extra input (422) -> resent without it, 200', async () => {
  setEnv({ flags: false });
  const gh = stubGitHub((body) => ('stripe_session_id' in body.inputs
    ? new Response(JSON.stringify({ message: 'Unexpected inputs provided: ["stripe_session_id"]' }), { status: 422 })
    : new Response(null, { status: 204 })));
  try {
    const res = await deliver(checkoutEvent(PATRON), null);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(gh.calls.length, 2);
    assert.ok(!('stripe_session_id' in gh.calls[1].body.inputs));
    assert.strictEqual(gh.calls[1].body.inputs.name, 'Jane');
  } finally { gh.restore(); }
});

test('webhook patron: other 422 / GitHub failure -> 500 so Stripe retries', async () => {
  setEnv({ flags: false });
  let gh = stubGitHub(() => new Response('{"message":"No ref found for: main"}', { status: 422 }));
  try {
    const res = await deliver(checkoutEvent(PATRON), null);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(gh.calls.length, 1);
  } finally { gh.restore(); }
  gh = stubGitHub(() => new Response('bad credentials', { status: 401 }));
  try {
    assert.strictEqual((await deliver(checkoutEvent(PATRON), null)).statusCode, 500);
  } finally { gh.restore(); }
});

test('webhook patron: KV configured but throwing -> falls back to the GitHub dispatch, 200', async () => {
  setEnv({ kvEnv: true });
  const kv = fakeKv({ throwing: true });
  const gh = stubGitHub();
  try {
    const res = await deliver(checkoutEvent(PATRON), kv);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(gh.calls.length, 1);
    assert.strictEqual(gh.calls[0].body.inputs.stripe_session_id, 'cs_test_kvsafe_1');
  } finally { gh.restore(); }
});

test('webhook patron: KV configured + flag on -> recorded in KV, no dispatch; retry is a no-op', async () => {
  setEnv({ kvEnv: true });
  const kv = fakeKv();
  const gh = stubGitHub();
  try {
    assert.strictEqual((await deliver(checkoutEvent(PATRON), kv)).statusCode, 200);
    assert.strictEqual((await deliver(checkoutEvent(PATRON), kv)).statusCode, 200);
    assert.strictEqual(gh.calls.length, 0);
    assert.strictEqual(kv.store.get('patrons:v1').supporter.length, 1);
  } finally { gh.restore(); }
});

test('webhook patron: GitHub path with KV configured dedupes a Stripe retry; a failed dispatch releases the claim', async () => {
  setEnv({ kvEnv: true, flags: false });
  const kv = fakeKv();
  let fail = true;
  const gh = stubGitHub(() => (fail ? new Response('boom', { status: 502 }) : new Response(null, { status: 204 })));
  try {
    assert.strictEqual((await deliver(checkoutEvent(PATRON), kv)).statusCode, 500);
    assert.ok(!kv.store.has('patron_dispatch:cs_test_kvsafe_1'), 'claim released after failure');
    fail = false;
    assert.strictEqual((await deliver(checkoutEvent(PATRON, { evtId: 'evt_test_1' }), kv)).statusCode, 200);
    const dup = await deliver(checkoutEvent(PATRON, { evtId: 'evt_test_1' }), kv);
    assert.deepStrictEqual([dup.statusCode, dup.body.duplicate], [200, true]);
    assert.strictEqual(gh.calls.length, 2, 'one failed + one successful dispatch, retry skipped');
  } finally { gh.restore(); }
});

// ---------- /api/data-download ----------
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

async function download(kv, { payment_status = 'paid' } = {}) {
  const stripeCalls = [];
  mocks['@vercel/kv'] = { kv };
  mocks['@vercel/blob'] = { head: async () => { throw new Error('blob must not be used'); } };
  mocks.stripe = () => ({ checkout: { sessions: { retrieve: async (id) => { stripeCalls.push(id);
    return { payment_status, metadata: LICENSE, customer_details: { email: 'buyer@example.invalid' } }; } } } });
  const h = fresh('data-download.js');
  const res = streamRes();
  await h({ method: 'GET', query: { session_id: 'cs_test_kvsafe_1' } }, res);
  await res.done;
  return { res, stripeCalls, text: Buffer.concat(res.chunks).toString('utf8') };
}

const BUNDLED = path.join(API, '_data', 'events.csv');
function assertServed({ res, text }) {
  if (fs.existsSync(BUNDLED)) {
    assert.notStrictEqual(res.statusCode, 500, JSON.stringify(res.body));
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.strictEqual(text, fs.readFileSync(BUNDLED, 'utf8'));
  } else {
    assert.deepStrictEqual(res.body, { error: 'Dataset not available yet' });
  }
}

test('data download: flag on, no KV env -> verified with Stripe, CSV served, KV untouched', async () => {
  setEnv();
  const kv = fakeKv({ throwing: true });
  const r = await download(kv);
  assert.deepStrictEqual(r.stripeCalls, ['cs_test_kvsafe_1']);
  assert.strictEqual(kv.calls.length, 0);
  assertServed(r);
});

test('data download: KV configured but every call throws -> Stripe paid check, CSV served', async () => {
  setEnv({ kvEnv: true });
  const kv = fakeKv({ throwing: true });
  const r = await download(kv);
  assert.deepStrictEqual(kv.calls.map((c) => c[0]), ['get', 'set']);
  assert.deepStrictEqual(r.stripeCalls, ['cs_test_kvsafe_1']);
  assertServed(r);
});

test('data download: KV down and session unpaid -> 403 (no free download)', async () => {
  setEnv({ kvEnv: true });
  const r = await download(fakeKv({ throwing: true }), { payment_status: 'unpaid' });
  assert.strictEqual(r.res.statusCode, 403);
});

test('data download: KV healthy hit -> served without a Stripe call', async () => {
  setEnv({ kvEnv: true });
  const kv = fakeKv();
  kv.store.set('data_license_session:cs_test_kvsafe_1', JSON.stringify({ tier: 'journalist' }));
  const r = await download(kv);
  assert.deepStrictEqual(r.stripeCalls, []);
  assertServed(r);
});

// ---------- /api/patrons ----------
const STATIC = JSON.parse(fs.readFileSync(path.join(API, '..', 'data', 'patrons.json'), 'utf8')).patrons;

async function patrons(kv) {
  mocks['@vercel/kv'] = { kv };
  const h = fresh('patrons.js');
  const res = mockRes();
  await h({ method: 'GET' }, res);
  return res;
}

test('patrons: flag on, no KV env -> 200 static list, KV untouched', async () => {
  setEnv();
  const kv = fakeKv({ throwing: true });
  const res = await patrons(kv);
  assert.deepStrictEqual([res.statusCode, res.body.patrons], [200, STATIC]);
  assert.strictEqual(kv.calls.length, 0);
});

test('patrons: KV configured but read throws -> 200 static list', async () => {
  setEnv({ kvEnv: true });
  const res = await patrons(fakeKv({ throwing: true }));
  assert.deepStrictEqual([res.statusCode, res.body.patrons], [200, STATIC]);
});

test('patrons: @vercel/kv absent -> 200 static list', async () => {
  setEnv({ kvEnv: true });
  const res = await patrons(null);
  assert.deepStrictEqual([res.statusCode, res.body.patrons], [200, STATIC]);
});

test('patrons: KV healthy -> KV list', async () => {
  setEnv({ kvEnv: true });
  const kv = fakeKv();
  const list = { founding: [], sustainer: [], supporter: [{ name: 'Jane', url: '' }] };
  kv.store.set('patrons:v1', list);
  const res = await patrons(kv);
  assert.deepStrictEqual([res.statusCode, res.body.patrons], [200, list]);
});
