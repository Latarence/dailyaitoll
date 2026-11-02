// CQA-DAT-PATRON-ATOMICITY: concurrent checkout sessions must all appear in the public patron listing,
// and a replayed session must not add a duplicate. @vercel/kv is stubbed with interleaving (yielding)
// reads so a read-modify-write of one shared object loses updates, exactly like two real invocations.
// Run: node --test tests/node/*.test.cjs
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
Module._load = function (request) {
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
const tick = () => new Promise((r) => setTimeout(r, 5));

// Every read yields after taking its snapshot, so overlapping handlers interleave.
function racyKv() {
  const store = new Map();
  const hashes = new Map();
  return {
    store, hashes,
    get: async (k) => { const v = store.has(k) ? structuredClone(store.get(k)) : null; await tick(); return v; },
    set: async (k, v) => { await tick(); store.set(k, structuredClone(v)); return 'OK'; },
    setnx: async (k, v) => { if (store.has(k)) return 0; store.set(k, v); return 1; },
    del: async (k) => (store.delete(k) ? 1 : 0),
    hgetall: async (k) => { const v = hashes.has(k) ? { ...hashes.get(k) } : null; await tick(); return v; },
    hsetnx: async (k, f, v) => { const h = hashes.get(k) || {}; if (h[f] !== undefined) return 0; hashes.set(k, { ...h, [f]: v }); return 1; },
  };
}

function setEnv() {
  for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'FEATURE_USE_KV_PATRONS', 'FEATURE_USE_KV_DATA_LICENSES', 'GITHUB_TOKEN']) delete process.env[k];
  Object.assign(process.env, { STRIPE_WEBHOOK_SECRET: SECRET, FEATURE_USE_KV_PATRONS: 'true',
    KV_REST_API_URL: 'https://kv.example.invalid', KV_REST_API_TOKEN: 't' });
}
function sign(raw) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}`;
}
async function deliver(kv, id, tier, name) {
  mocks['@vercel/kv'] = { kv };
  mocks.stripe = () => { throw new Error('Stripe must not be called'); };
  const handler = fresh('stripe-webhook.js');
  const raw = JSON.stringify({ id: `evt_${id}`, type: 'checkout.session.completed', created: 1,
    data: { object: { id, metadata: { kind: 'patron', tier, name, url: '' }, customer_details: {} } } });
  const req = Readable.from([Buffer.from(raw)]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': sign(raw) };
  const res = mockRes();
  await handler(req, res);
  return res;
}
async function listing(kv) {
  mocks['@vercel/kv'] = { kv };
  const res = mockRes();
  await fresh('patrons.js')({ method: 'GET' }, res);
  assert.strictEqual(res.statusCode, 200);
  return res.body.patrons;
}

test('two concurrent sessions in the same tier both appear', async () => {
  setEnv();
  const kv = racyKv();
  const [a, b] = await Promise.all([deliver(kv, 'cs_A', 'supporter', 'Alice'), deliver(kv, 'cs_B', 'supporter', 'Bob')]);
  assert.deepStrictEqual([a.statusCode, b.statusCode], [200, 200]);
  const names = (await listing(kv)).supporter.map((p) => p.name).sort();
  assert.deepStrictEqual(names, ['Alice', 'Bob']);
});

test('concurrent sessions in different tiers do not erase each other', async () => {
  setEnv();
  const kv = racyKv();
  await Promise.all([deliver(kv, 'cs_A', 'supporter', 'Alice'), deliver(kv, 'cs_B', 'sustainer', 'Bob'), deliver(kv, 'cs_C', 'founding', 'Cy')]);
  const p = await listing(kv);
  assert.deepStrictEqual([p.supporter.length, p.sustainer.length, p.founding.length], [1, 1, 1]);
});

test('replaying a session adds no duplicate', async () => {
  setEnv();
  const kv = racyKv();
  await deliver(kv, 'cs_A', 'supporter', 'Alice');
  await deliver(kv, 'cs_A', 'supporter', 'Alice');
  assert.strictEqual((await listing(kv)).supporter.length, 1);
});

test('legacy patrons:v1 entries still list, after new ones', async () => {
  setEnv();
  const kv = racyKv();
  kv.store.set('patrons:v1', { founding: [], sustainer: [], supporter: [{ name: 'Old', url: '' }] });
  await deliver(kv, 'cs_A', 'supporter', 'Alice');
  assert.deepStrictEqual((await listing(kv)).supporter.map((p) => p.name), ['Alice', 'Old']);
});
