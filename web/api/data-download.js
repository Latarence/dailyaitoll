const fs = require('fs');
const path = require('path');
let kv;
try {
  ({ kv } = require('@vercel/kv'));
} catch {
  kv = null;
}
const { Readable } = require('stream');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// @vercel/blob 1.x has no get(): look the blob up with head(), then fetch it server-side and stream it,
// so the client only ever talks to this API and never sees the blob URL.
let blobHead;
try {
  ({ head: blobHead } = require('@vercel/blob'));
} catch {
  blobHead = null;
}
const DATASET_PATHNAME = 'datasets/events.csv';

async function fetchBlobDataset() {
  let meta;
  try {
    meta = await blobHead(DATASET_PATHNAME);
  } catch (err) {
    // BlobNotFoundError (not uploaded yet) or a store error: the dataset isn't available.
    console.error('blob head failed:', err && err.message);
    return null;
  }
  if (!meta || !meta.url) return null;
  const r = await fetch(meta.url, { cache: 'no-store' });
  if (!r.ok || !r.body) return null;
  return r.body;
}

async function hasLicense(sessionId) {
  if (!kv) return null;
  const v = await kv.get(`data_license_session:${sessionId}`);
  if (!v) return null;
  try {
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionId = req.query?.session_id;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  try {
    // Fast path: already recorded via webhook.
    let license = process.env.FEATURE_USE_KV_DATA_LICENSES === 'true' ? await hasLicense(sessionId) : null;

    // Slow path: verify with Stripe (covers webhook delays).
    if (!license) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (!session || session.payment_status !== 'paid') {
        return res.status(403).json({ error: 'Payment not verified' });
      }

      const kind = session.metadata?.kind;
      const tier = session.metadata?.tier;
      if (kind !== 'data_license' || !tier) {
        return res.status(403).json({ error: 'Not a data license purchase' });
      }

      const email = session.customer_details?.email || session.customer_email || '';

      if (process.env.FEATURE_USE_KV_DATA_LICENSES === 'true' && kv) {
        await kv.set(
          `data_license_session:${sessionId}`,
          JSON.stringify({ tier, email, created_at: new Date().toISOString() })
        );
      }

      license = { tier, email };
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="daily-ai-toll-events.csv"');

    if (process.env.FEATURE_USE_BLOB_DATASET === 'true') {
      if (!blobHead) return res.status(500).json({ error: 'Blob not available' });
      const body = await fetchBlobDataset();
      if (!body) {
        return res.status(500).json({ error: 'Dataset not available yet' });
      }
      Readable.fromWeb(body).pipe(res);
      return;
    }

    // Fallback: serve the CSV bundled at web/api/_data/events.csv (never a static path), only through this API.
    const csvPath = path.join(__dirname, '_data', 'events.csv');
    if (!fs.existsSync(csvPath)) {
      return res.status(500).json({ error: 'Dataset not available yet' });
    }
    fs.createReadStream(csvPath).pipe(res);
    return;
  } catch (err) {
    console.error('data download error:', err);
    return res.status(500).json({ error: 'Failed to verify download' });
  }
};
