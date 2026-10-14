// GET /api/health -> {ok, kv, blob, kv_required, blob_required, disputes, built_at, commit}
// Checks the storage the site actually depends on:
//   - Vercel KV (Upstash) backs patrons and data licenses when FEATURE_USE_KV_PATRONS /
//     FEATURE_USE_KV_DATA_LICENSES are 'true'; it is pinged whenever it is configured or required.
//   - Vercel Blob serves the dataset when FEATURE_USE_BLOB_DATASET is 'true'.
// disputes: {total, open, last_updated_at} from the KV hash written by the Stripe webhook
//   (charge.dispute.*), or null when KV is unreachable. Counts only; it never changes `ok`.
// 503 when a required dependency is unreachable. Never returns env values, URLs or tokens.
const fs = require('fs');
const path = require('path');
const { disputeSummary } = require('./_lib/disputes');

const TIMEOUT_MS = 2500;

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(t));
}

function loadKv() {
  try { return require('@vercel/kv').kv; } catch { return null; }
}

function loadBlobHead() {
  try { return require('@vercel/blob').head; } catch { return null; }
}

function buildInfo() {
  let stamp = {};
  try {
    stamp = JSON.parse(fs.readFileSync(path.join(__dirname, '_build.json'), 'utf8'));
  } catch { /* no build stamp (local run or older deploy) */ }
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || stamp.commit || null;
  return {
    built_at: stamp.built_at || null,
    commit: commit ? String(commit).slice(0, 40) : null,
  };
}

async function checkDisputes(deps) {
  const kv = deps.kv === undefined ? loadKv() : deps.kv;
  try {
    return await withTimeout(disputeSummary(kv), deps.timeoutMs || TIMEOUT_MS);
  } catch {
    return null;
  }
}

async function checkKv(deps) {
  const kv = deps.kv === undefined ? loadKv() : deps.kv;
  const configured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (!kv || !configured) return 'unreachable';
  try {
    const r = await withTimeout(kv.ping(), deps.timeoutMs || TIMEOUT_MS);
    return String(r).toUpperCase() === 'PONG' ? 'reachable' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

async function checkBlob(deps) {
  const head = deps.blobHead === undefined ? loadBlobHead() : deps.blobHead;
  if (!head || !process.env.BLOB_READ_WRITE_TOKEN) return 'unreachable';
  try {
    const meta = await withTimeout(head('datasets/events.csv'), deps.timeoutMs || TIMEOUT_MS);
    return meta ? 'reachable' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

function makeHandler(deps = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const kvRequired =
      process.env.FEATURE_USE_KV_PATRONS === 'true' || process.env.FEATURE_USE_KV_DATA_LICENSES === 'true';
    const blobRequired = process.env.FEATURE_USE_BLOB_DATASET === 'true';

    const [kv, blob] = await Promise.all([
      checkKv(deps),
      blobRequired ? checkBlob(deps) : Promise.resolve('not_used'),
    ]);

    const disputes = kv === 'reachable' ? await checkDisputes(deps) : null;
    const ok = (!kvRequired || kv === 'reachable') && (!blobRequired || blob === 'reachable');
    const body = { ok, kv, kv_required: kvRequired, blob, blob_required: blobRequired, disputes, ...buildInfo() };
    return res.status(ok ? 200 : 503).json(body);
  };
}

module.exports = makeHandler();
module.exports.makeHandler = makeHandler;
